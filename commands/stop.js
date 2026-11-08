const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const COLORS = { error: 0xed4245, success: 0x57f287 };
const buildContainer = (text, color) => new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
const V2_EPHEMERAL = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrete l'evenement et desactive le calendrier"),
  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({
        components: [buildContainer("## Vous n'avez pas la permission d'utiliser cette commande.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    const config = interaction.client.db.getConfig();
    if (!config.eventActive) {
      return interaction.reply({
        components: [buildContainer("## Calendrier déjà désactivé\nLe calendrier est déjà désactivé.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    await interaction.deferReply({ flags: V2_EPHEMERAL });
    config.eventActive = false;
    config.eventStoppedAt = new Date().toISOString();
    interaction.client.db.saveConfig(config);
    await interaction.client.buildCalendar.refreshPublicMessage(interaction.client);
    return interaction.editReply({
      components: [buildContainer("## Calendrier désactivé\nLe calendrier est désactivé et les événements précédents sont publiés.", COLORS.success)],
      flags: V2_EPHEMERAL,
    });
  },
};