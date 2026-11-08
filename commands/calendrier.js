const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const COLORS = { error: 0xed4245 };
const buildContainer = (text, color) => new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
const V2_EPHEMERAL = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
module.exports = {
  data: new SlashCommandBuilder()
    .setName("calendrier")
    .setDescription("Ouvre le panel de configuration du calendrier de l'Avent"),
  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({
        components: [buildContainer("## Vous n'avez pas la permission d'utiliser cette commande.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    const payload = interaction.client.buildCalendar.buildConfigPanelPayload();
    return interaction.reply({
      ...payload,
      flags: (payload.flags | MessageFlags.IsComponentsV2),
    });
  },
};