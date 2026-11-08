const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const COLORS = { error: 0xed4245, success: 0x57f287 };
const buildContainer = (text, color) => new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
const V2_EPHEMERAL = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
module.exports = {
  data: new SlashCommandBuilder()
    .setName("evenement")
    .setDescription("Lance l'evenement du calendrier de l'Avent"),
  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({
        components: [buildContainer("## Vous n'avez pas la permission d'utiliser cette commande.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    const config = interaction.client.db.getConfig();
    if (!config.channelId || !config.messageId) {
      return interaction.reply({
        components: [buildContainer("## Erreur\nLes paramètres du calendrier ne sont pas configurés.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    const rewardCount = interaction.client.db.getRewardCount();
    if (rewardCount === 0) {
      return interaction.reply({
        components: [buildContainer("## Aucune récompense\nAucune récompense n'a été configurée.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    if (config.eventActive) {
      return interaction.reply({
        components: [buildContainer("## Calendrier déjà lancé\nLe calendrier est déjà lancé.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    await interaction.deferReply({ flags: V2_EPHEMERAL });
    config.eventActive = true;
    config.eventStartedAt = new Date().toISOString();
    config.eventStoppedAt = null;
    interaction.client.db.saveConfig(config);
    await interaction.client.buildCalendar.refreshPublicMessage(interaction.client);
    return interaction.editReply({
      components: [buildContainer("## Calendrier lancé\nL'événement est lancé et les récompenses sont publiées.", COLORS.success)],
    });
  },
};