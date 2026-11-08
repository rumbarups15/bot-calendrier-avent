const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const COLORS = { error: 0xed4245, success: 0x57f287 };
const V2_EPHEMERAL = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const CHECK_INTERVAL_MS = 30_000;
function buildContainer(text, color) {
  return new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}
function respond(interaction, text, color) {
  return interaction.reply({ components: [buildContainer(text, color)], flags: V2_EPHEMERAL });
}
function parseDate(input) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const [day, month, year, hours, minutes] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  if (isNaN(date.getTime()) || date.getDate() !== day || date.getMonth() !== month - 1) return null;
  return date;
}
async function closeEvent(client) {
  const config = client.db.getConfig();
  config.autoCloseAt = null;
  if (config.eventActive) {
    config.eventActive = false;
    config.eventStoppedAt = new Date().toISOString();
  }
  client.db.saveConfig(config);
  await client.buildCalendar.refreshPublicMessage(client);
}
function startAutoCloseWatcher(client) {
  if (client.autoCloseInterval) return;
  client.autoCloseInterval = setInterval(async () => {
    const config = client.db.getConfig();
    if (!config.autoCloseAt) return;
    if (Date.now() < new Date(config.autoCloseAt).getTime()) return;
    try {
      await closeEvent(client);
      console.log("Événement clôturé automatiquement.");
    } catch (err) {
      console.error("Erreur lors de la clôture automatique:", err);
    }
  }, CHECK_INTERVAL_MS);
}
const command = {
  data: new SlashCommandBuilder()
    .setName("cloture")
    .setDescription("Programme la clôture automatique de l'événement")
    .addStringOption((option) =>
      option
        .setName("date")
        .setDescription("Date et heure de clôture")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({
        components: [buildContainer("## Vous n'avez pas la permission d'utiliser cette commande.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    const date = parseDate(interaction.options.getString("date", true));
    if (!date) {
      return respond(interaction, "## Format invalide\nLe format de la date est incorrect.", COLORS.error);
    }
    if (date.getTime() <= Date.now()) {
      return respond(interaction, "## Date passée\nLa date doit être dans le futur.", COLORS.error);
    }
    const config = interaction.client.db.getConfig();
    config.autoCloseAt = date.toISOString();
    interaction.client.db.saveConfig(config);
    return respond(
      interaction,
      `## Clôture automatique programmée\nLa clôture automatique est programmée pour le ${date.toLocaleDateString()} à ${date.toLocaleTimeString()}.`,
      COLORS.success
    );
  },
};
module.exports = command;
module.exports.startAutoCloseWatcher = startAutoCloseWatcher;