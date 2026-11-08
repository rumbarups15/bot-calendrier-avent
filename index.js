const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, SeparatorBuilder, SeparatorSpacingSize, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require("discord.js");
const { startAutoCloseWatcher } = require("./commands/cloture.js");
const DATA_DIR = path.join(__dirname, "data");
const FILES = {
  config: path.join(DATA_DIR, "config.json"),
  rewards: path.join(DATA_DIR, "rewards.json"),
  progress: path.join(DATA_DIR, "progress.json"),
};
const BACKUP_ROOT = path.join(DATA_DIR, "backups");
const LOG_PATH = path.join(DATA_DIR, "logs.txt");
const DEFAULT_CONFIG = {
  channelId: null,
  messageId: null,
  eventActive: false,
  eventStartedAt: null,
  eventStoppedAt: null,
};
const COLORS = { error: 0xed4245, success: 0x57f287, info: 0x5865f2 };
const V2_EPHEMERAL = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const OWNER_ONLY = "## Accès refusé\nSeul le propriétaire du bot peut utiliser cette commande.";
const CLICK_COOLDOWN_MS = 2000;
const MODAL_MAX_FAILURES = 5;
const MODAL_WINDOW_MS = 10 * 60 * 1000;
const MODAL_BLOCK_MS = 10 * 60 * 1000;
const TICK_MS = 60 * 1000;
const BACKUP_KEEP = 7;
const cache = {};
let lastEventActive = null;
let lastDay = null;
const lastClick = new Map();
const modalFailures = new Map();
const modalBlockedUntil = new Map();
const activeLocks = new Set();
function logAction(action, details = {}) {
  const line = `${new Date().toISOString()} | ${action} | ${JSON.stringify(details)}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch (err) {
    console.error("Impossible d'écrire dans le journal:", err);
  }
}
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}
function writeAtomic(filePath, data) {
  ensureDataDir();
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}
function load(name, fallback) {
  if (cache[name] !== undefined) {
    return cache[name];
  }
  ensureDataDir();
  const filePath = FILES[name];
  let data = fallback;
  if (!fs.existsSync(filePath)) {
    writeAtomic(filePath, fallback);
  } else {
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.trim()) {
      data = JSON.parse(raw);
    }
  }
  if (name === "config" && lastEventActive === null) {
    lastEventActive = Boolean(data.eventActive);
  }
  cache[name] = data;
  return data;
}
function save(name, data) {
  cache[name] = data;
  writeAtomic(FILES[name], data);
}
function getConfig() {
  return load("config", { ...DEFAULT_CONFIG });
}
function saveConfig(config) {
  const eventActive = Boolean(config.eventActive);
  if (lastEventActive !== null && eventActive !== lastEventActive) {
    logAction(eventActive ? "evenement_lance" : "evenement_arrete", { date: new Date().toISOString() });
  }
  lastEventActive = eventActive;
  save("config", config);
}
function getRewards() {
  return load("rewards", {});
}
function saveRewards(rewards) {
  save("rewards", rewards);
}
function setReward(day, reward) {
  const rewards = getRewards();
  rewards[String(day)] = reward;
  saveRewards(rewards);
  return rewards;
}
function getRewardCount() {
  return Object.keys(getRewards()).length;
}
function getProgress() {
  return load("progress", {});
}
function saveProgress(progress) {
  save("progress", progress);
}
function getUserProgress(userId) {
  const progress = getProgress();
  if (!progress[userId]) {
    progress[userId] = { claimed: {} };
  }
  return progress[userId];
}
function hasClaimedDay(userId, day) {
  return Boolean(getUserProgress(userId).claimed[String(day)]);
}
function claimDay(userId, day, reward) {
  const progress = getProgress();
  if (!progress[userId]) {
    progress[userId] = { claimed: {} };
  }
  progress[userId].claimed[String(day)] = {
    reward,
    claimedAt: new Date().toISOString(),
  };
  saveProgress(progress);
  return progress[userId];
}
function getAllUsersWhoClaimedDay(day) {
  const progress = getProgress();
  return Object.keys(progress).filter((userId) => progress[userId].claimed[String(day)]);
}
const db = {
  getConfig,
  saveConfig,
  getRewards,
  saveRewards,
  setReward,
  getRewardCount,
  getProgress,
  saveProgress,
  getUserProgress,
  hasClaimedDay,
  claimDay,
  getAllUsersWhoClaimedDay,
};
function checkClickCooldown(userId) {
  const now = Date.now();
  const last = lastClick.get(userId) ?? 0;
  if (now - last < CLICK_COOLDOWN_MS) {
    return false;
  }
  lastClick.set(userId, now);
  return true;
}
function getModalBlockRemaining(userId) {
  const until = modalBlockedUntil.get(userId) ?? 0;
  return Math.max(0, until - Date.now());
}
function recordModalFailure(userId) {
  const now = Date.now();
  const recent = (modalFailures.get(userId) ?? []).filter((time) => now - time < MODAL_WINDOW_MS);
  recent.push(now);
  if (recent.length >= MODAL_MAX_FAILURES) {
    modalBlockedUntil.set(userId, now + MODAL_BLOCK_MS);
    modalFailures.delete(userId);
  } else {
    modalFailures.set(userId, recent);
  }
}
function acquireLock(userId) {
  if (activeLocks.has(userId)) {
    return false;
  }
  activeLocks.add(userId);
  return true;
}
function releaseLock(userId) {
  activeLocks.delete(userId);
}
function localDay(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
function rotateBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) {
    return;
  }
  const folders = fs
    .readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of folders.slice(0, -BACKUP_KEEP)) {
    fs.rmSync(path.join(BACKUP_ROOT, name), { recursive: true, force: true });
  }
}
function backupData() {
  const day = localDay();
  const target = path.join(BACKUP_ROOT, day);
  fs.mkdirSync(target, { recursive: true });
  for (const filePath of Object.values(FILES)) {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, path.join(target, path.basename(filePath)));
    }
  }
  rotateBackups();
  logAction("sauvegarde", { dossier: day });
}
function startDailyScheduler(client, onNewDay) {
  if (client.schedulerInterval) {
    return;
  }
  const runDailyTasks = async () => {
    const today = localDay();
    if (today === lastDay) {
      return;
    }
    lastDay = today;
    try {
      backupData();
    } catch (err) {
      console.error("Erreur lors de la sauvegarde:", err);
    }
    try {
      await onNewDay(client);
    } catch (err) {
      console.error("Erreur lors du rafraîchissement quotidien:", err);
    }
  };
  client.schedulerInterval = setInterval(runDailyTasks, TICK_MS);
  runDailyTasks();
}
const chunk = (array, size) => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};
function isDayClaimedByAnyone(day) {
  return getAllUsersWhoClaimedDay(day).length > 0;
}
function buildContainer(text, color = COLORS.info) {
  return new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}
function respond(interaction, text, color = COLORS.info) {
  return interaction.reply({ components: [buildContainer(text, color)], flags: V2_EPHEMERAL });
}
function isNotOwner(interaction) {
  const ownerId = process.env.OWNER_ID;
  return Boolean(ownerId && interaction.user.id !== ownerId);
}
function buildDayButton(day, userId, mode) {
  let claimed;
  if (mode === "personal" && userId) {
    claimed = hasClaimedDay(userId, day);
  } else {
    claimed = isDayClaimedByAnyone(day);
  }
  const style = claimed ? ButtonStyle.Success : ButtonStyle.Danger;
  return new ButtonBuilder().setCustomId(`avent_day_${day}`).setLabel(`${day}`).setStyle(style).setDisabled(true);
}
function buildCalendarContainer(userId, mode = "public") {
  const config = getConfig();
  const rewardCount = getRewardCount();
  const totalDays = rewardCount > 0 ? rewardCount : 24;
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Calendrier de l'Avent\n"));
  let statusText;
  if (!config.eventActive && !config.eventStoppedAt) {
    statusText = "L'événement n'a pas encore commencé.\n";
  } else if (config.eventActive) {
    statusText = "L'événement est **en cours** ! Cliquez sur **Tirer** chaque jour pour récupérer votre récompense.\n";
  } else {
    statusText = "L'événement est **terminé**.";
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const days = Array.from({ length: totalDays }, (_, i) => i + 1);
  for (const rowDays of chunk(days, 5)) {
    const actionRow = new ActionRowBuilder();
    for (const day of rowDays) {
      actionRow.addComponents(buildDayButton(day, userId, mode));
    }
    container.addActionRowComponents(actionRow);
  }
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const actionsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("avent_inventaire").setLabel("Inventaire").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("avent_tirer").setLabel("Tirer").setStyle(ButtonStyle.Primary).setDisabled(!config.eventActive));
  container.addActionRowComponents(actionsRow);
  return container;
}
function buildCalendarPayload(userId) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [buildCalendarContainer(userId, "public")],
  };
}
function buildEphemeralCalendarPayload(userId) {
  return {
    flags: V2_EPHEMERAL,
    components: [buildCalendarContainer(userId, "personal")],
  };
}
function isMissingError(err) {
  return err?.code === 10003 || err?.code === 10008;
}
async function notifyOwner(client, text) {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    return;
  }
  try {
    const owner = await client.users.fetch(ownerId);
    await owner.send({
      components: [buildContainer(text, COLORS.error)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    console.error("Impossible d'envoyer le message au propriétaire:", err);
  }
}
async function handleMissingCalendar(client, config, err) {
  const channelGone = err.code === 10003;
  if (channelGone) {
    config.channelId = null;
  }
  config.messageId = null;
  saveConfig(config);
  logAction("calendrier_introuvable", { salonSupprime: channelGone });
  const advice = channelGone
    ? "Le salon du calendrier a été supprimé. Utilise `/calendrier` pour en choisir un nouveau."
    : "Le message du calendrier a été supprimé. Utilise `/calendrier` puis **Rafraîchir** pour le recréer.";
  await notifyOwner(client, `## Calendrier introuvable\n${advice}`);
}
async function refreshPublicMessage(client) {
  const config = getConfig();
  if (!config.channelId || !config.messageId) {
    return;
  }
  try {
    const channel = await client.channels.fetch(config.channelId);
    const message = await channel.messages.fetch(config.messageId);
    await message.edit(buildCalendarPayload());
  } catch (err) {
    if (isMissingError(err)) {
      await handleMissingCalendar(client, config, err);
      return;
    }
    console.error("Impossible de rafraichir le message du calendrier:", err);
  }
}
function buildConfigPanelContainer() {
  const config = getConfig();
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Configuration du calendrier de l'Avent\n"));
  const statusText = config.channelId ? `Salon configuré : <#${config.channelId}>\n` : "Aucun salon n'est configuré pour le moment.\n";
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const selectRow = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("avent_panel_salon").setPlaceholder("Choisir le salon").addChannelTypes(ChannelType.GuildText));
  container.addActionRowComponents(selectRow);
  const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("avent_panel_rafraichir").setLabel("Rafraîchir").setStyle(ButtonStyle.Primary).setDisabled(!config.channelId));
  container.addActionRowComponents(buttonRow);
  return container;
}
function buildConfigPanelPayload() {
  return {
    flags: V2_EPHEMERAL,
    components: [buildConfigPanelContainer()],
  };
}
async function handlePanelSalonSelect(interaction) {
  if (isNotOwner(interaction)) {
    return respond(interaction, OWNER_ONLY, COLORS.error);
  }
  await interaction.deferUpdate();
  const channel = interaction.channels.first();
  const config = getConfig();
  const sentMessage = await channel.send(buildCalendarPayload());
  if (config.channelId && config.messageId) {
    try {
      const oldChannel = await interaction.client.channels.fetch(config.channelId);
      const oldMessage = await oldChannel.messages.fetch(config.messageId);
      await oldMessage.delete();
    } catch {}
  }
  config.channelId = channel.id;
  config.messageId = sentMessage.id;
  saveConfig(config);
  logAction("salon_configure", { salon: channel.id });
  return interaction.editReply(buildConfigPanelPayload());
}
async function handlePanelRafraichir(interaction) {
  if (isNotOwner(interaction)) {
    return respond(interaction, OWNER_ONLY, COLORS.error);
  }
  const config = getConfig();
  if (!config.channelId) {
    return respond(interaction, "## Non configuré\nAucun salon n'est configuré.", COLORS.error, { ephemeral: true });
  }
  await interaction.deferUpdate();
  try {
    const channel = await interaction.client.channels.fetch(config.channelId);
    const sentMessage = await channel.send(buildCalendarPayload());
    if (config.messageId) {
      try {
        const oldMessage = await channel.messages.fetch(config.messageId);
        await oldMessage.delete();
      } catch {}
    }
    config.messageId = sentMessage.id;
    saveConfig(config);
    logAction("calendrier_rafraichi", { salon: channel.id });
    return interaction.editReply(buildConfigPanelPayload());
  } catch (err) {
    console.error("Erreur lors du rafraîchissement du calendrier:", err.message);
    return interaction.followUp({
      components: [buildContainer(`## Erreur\nErreur lors du rafraîchissement : ${err}`, COLORS.error)],
      flags: V2_EPHEMERAL,
    });
  }
}
function buildRewardConfigContainer() {
  const rewards = getRewards();
  const days = Object.keys(rewards).map(Number).sort((a, b) => a - b);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Configuration des récompenses"));
  const listText = days.length === 0 ? "Aucune récompense n'est configurée pour le moment." : days.map((day) => `**Jour ${day}** : ${rewards[String(day)]}`).join("\n");
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(listText));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reward_panel_definir").setLabel("Définir une récompense").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("reward_panel_supprimer").setLabel("Supprimer une récompense").setStyle(ButtonStyle.Danger).setDisabled(days.length === 0));
  container.addActionRowComponents(buttonRow);
  return container;
}
function buildRewardConfigPayload() {
  return {
    flags: V2_EPHEMERAL,
    components: [buildRewardConfigContainer()],
  };
}
function modalBlockedResponse(interaction) {
  const remaining = getModalBlockRemaining(interaction.user.id);
  if (remaining <= 0) {
    return null;
  }
  const minutes = Math.ceil(remaining / 60000);
  return respond(interaction, `## Trop de tentatives\nRéessaie dans environ **${minutes} minute(s)**.`, COLORS.error, { ephemeral: true });
}
async function handleRewardPanelDefinir(interaction) {
  if (isNotOwner(interaction)) {
    return respond(interaction, OWNER_ONLY, COLORS.error);
  }
  const modal = new ModalBuilder().setCustomId("reward_modal_definir").setTitle("Définir une récompense");
  const dayInput = new TextInputBuilder().setCustomId("reward_modal_jour").setLabel("Numéro du jour").setStyle(TextInputStyle.Short).setRequired(true);
  const rewardInput = new TextInputBuilder().setCustomId("reward_modal_texte").setLabel("Texte de la récompense").setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(dayInput), new ActionRowBuilder().addComponents(rewardInput));
  return interaction.showModal(modal);
}
async function handleRewardModalDefinir(interaction) {
  if (isNotOwner(interaction)) {
    return respond(interaction, OWNER_ONLY, COLORS.error);
  }
  const blocked = modalBlockedResponse(interaction);
  if (blocked) {
    return blocked;
  }
  const day = parseInt(interaction.fields.getTextInputValue("reward_modal_jour"), 10);
  const reward = interaction.fields.getTextInputValue("reward_modal_texte");
  if (isNaN(day) || day < 1 || day > 31) {
    recordModalFailure(interaction.user.id);
    return respond(interaction, "## Numéro invalide\nNuméro de jour invalide.", COLORS.error, { ephemeral: true });
  }
  await interaction.deferUpdate();
  setReward(day, reward);
  logAction("recompense_definie", { jour: day, recompense: reward, par: interaction.user.id });
  await refreshPublicMessage(interaction.client);
  return interaction.editReply(buildRewardConfigPayload());
}
async function handleRewardPanelSupprimer(interaction) {
  if (isNotOwner(interaction)) {
    return respond(interaction, OWNER_ONLY, COLORS.error);
  }
  const modal = new ModalBuilder().setCustomId("reward_modal_supprimer").setTitle("Supprimer une récompense");
  const dayInput = new TextInputBuilder().setCustomId("reward_modal_jour").setLabel("Numéro du jour").setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(dayInput));
  return interaction.showModal(modal);
}
async function handleRewardModalSupprimer(interaction) {
  if (isNotOwner(interaction)) {
    return respond(interaction, OWNER_ONLY, COLORS.error);
  }
  const blocked = modalBlockedResponse(interaction);
  if (blocked) {
    return blocked;
  }
  const day = parseInt(interaction.fields.getTextInputValue("reward_modal_jour"), 10);
  const rewards = getRewards();
  if (isNaN(day) || !rewards[String(day)]) {
    recordModalFailure(interaction.user.id);
    return respond(interaction, `## Introuvable\nAucune récompense n'est définie pour le jour ${day}.`, COLORS.error, { ephemeral: true });
  }
  await interaction.deferUpdate();
  delete rewards[String(day)];
  saveRewards(rewards);
  logAction("recompense_supprimee", { jour: day, par: interaction.user.id });
  await refreshPublicMessage(interaction.client);
  return interaction.editReply(buildRewardConfigPayload());
}
function getCurrentDay(config) {
  if (!config.eventStartedAt) {
    return null;
  }
  const start = new Date(config.eventStartedAt);
  const now = new Date();
  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((nowMidnight - startMidnight) / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}
async function claimCurrentDay(interaction) {
  const config = getConfig();
  if (!config.eventActive) {
    return respond(interaction, "## Inactif\nL'événement n'est pas actif actuellement.", COLORS.error, { ephemeral: true });
  }
  const rewardCount = getRewardCount();
  const currentDay = getCurrentDay(config);
  if (currentDay === null || currentDay < 1) {
    return respond(interaction, "## Pas commencé\nL'événement n'a pas encore commencé.", COLORS.error, { ephemeral: true });
  }
  if (currentDay > rewardCount) {
    return respond(interaction, "## Terminé\nToutes les cases disponibles ont déjà été révélées.", COLORS.error, { ephemeral: true });
  }
  const userId = interaction.user.id;
  if (hasClaimedDay(userId, currentDay)) {
    return respond(interaction, `## Déjà récupérée\nVous avez déjà récupéré la récompense du **jour ${currentDay}** !\nRevenez demain pour la prochaine case.`, COLORS.error, { ephemeral: true });
  }
  const reward = getRewards()[String(currentDay)];
  if (!reward) {
    return respond(interaction, `## ⚠️ Non configuré\nAucune récompense n'est configurée pour le jour ${currentDay}. Contactez le propriétaire du bot.`, COLORS.error);
  }
  claimDay(userId, currentDay, reward);
  logAction("tirage", { utilisateur: userId, jour: currentDay, recompense: reward });
  await refreshPublicMessage(interaction.client);
  return respond(interaction, `## Jour ${currentDay} débloqué !\nVotre récompense : **${reward}**`, COLORS.success, { ephemeral: true });
}
async function handleTirer(interaction) {
  const userId = interaction.user.id;
  if (!acquireLock(userId)) {
    return respond(interaction, "## Patiente\nUne action est déjà en cours pour toi.", COLORS.info, { ephemeral: true });
  }
  try {
    return await claimCurrentDay(interaction);
  } finally {
    releaseLock(userId);
  }
}
async function handleInventaire(interaction) {
  const userProgress = getUserProgress(interaction.user.id);
  const claimedDays = Object.keys(userProgress.claimed).map(Number).sort((a, b) => a - b);
  const container = new ContainerBuilder().setAccentColor(COLORS.info);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Inventaire de ${interaction.user.username}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  if (claimedDays.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("Vous n'avez encore récupéré aucune récompense."));
  } else {
    const lines = claimedDays.map((day) => `**Jour ${day}** : ${userProgress.claimed[String(day)].reward}`);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Vous avez récupéré **${claimedDays.length}** récompense(s) :\n${lines.join("\n")}`));
  }
  return interaction.reply({ components: [container], flags: V2_EPHEMERAL });
}
async function handleDayClick(interaction, day) {
  const userId = interaction.user.id;
  if (hasClaimedDay(userId, day)) {
    const entry = getUserProgress(userId).claimed[String(day)];
    return respond(interaction, `## Jour ${day} débloqué !\nVotre récompense : **${entry.reward}**`, COLORS.success);
  }
  return respond(interaction, `## Inactif\nLa case du **jour ${day}** n'a pas encore été débloquée.`, COLORS.error);
}
async function interactionCreate(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) {
        return;
      }
      return command.execute(interaction);
    }
    const isClick = interaction.isButton() || interaction.isChannelSelectMenu();
    if (isClick && !checkClickCooldown(interaction.user.id)) {
      return respond(interaction, "## Patiente\nUne action est déjà en cours pour toi.", COLORS.info);
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === "avent_panel_salon") {
      return handlePanelSalonSelect(interaction);
    }
    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (customId === "avent_panel_rafraichir") {
        return handlePanelRafraichir(interaction);
      }
      if (customId === "avent_tirer") {
        return handleTirer(interaction);
      }
      if (customId === "avent_inventaire") {
        return handleInventaire(interaction);
      }
      if (customId.startsWith("avent_day_")) {
        return handleDayClick(interaction, parseInt(customId.replace("avent_day_", ""), 10));
      }
      if (customId === "reward_panel_definir") {
        return handleRewardPanelDefinir(interaction);
      }
      if (customId === "reward_panel_supprimer") {
        return handleRewardPanelSupprimer(interaction);
      }
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "reward_modal_definir") {
        return handleRewardModalDefinir(interaction);
      }
      if (interaction.customId === "reward_modal_supprimer") {
        return handleRewardModalSupprimer(interaction);
      }
    }
  } catch (err) {
    console.error("Erreur lors du traitement de l'interaction:", err);
    const errorBody = {
      components: [buildContainer(`## Erreur\n${err}`, COLORS.error)],
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorBody).catch(() => {});
    } else {
      await interaction.reply({ ...errorBody, flags: V2_EPHEMERAL }).catch(() => {});
    }
  }
}
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
client.commands = new Collection();
client.db = db;
client.buildCalendar = {
  buildCalendarContainer,
  buildCalendarPayload,
  buildEphemeralCalendarPayload,
  buildConfigPanelPayload,
  buildRewardConfigPayload,
  refreshPublicMessage,
};
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));
const commandsData = [];
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    commandsData.push(command.data.toJSON());
  }
}
client.on("interactionCreate", interactionCreate);
async function deployCommands() {
  const rest = new REST().setToken(process.env.TOKEN);
  try {
    console.log(`Déploiement de ${commandsData.length} commande(s)...`);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsData });
    console.log("Commandes déployées avec succès.");
  } catch (err) {
    console.error("Erreur lors du déploiement des commandes:", err);
  }
}
client.once("clientReady", () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  startAutoCloseWatcher(client);
  startDailyScheduler(client, refreshPublicMessage);
});
(async () => {
  await deployCommands();
  await client.login(process.env.TOKEN);
})();