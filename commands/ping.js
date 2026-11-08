const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const COLORS = { error: 0xed4245, success: 0x57f287 };
const buildContainer = (text, color) => new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
const V2_EPHEMERAL = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Affiche la latence du bot"),
  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({
        components: [buildContainer("## Vous n'avez pas la permission d'utiliser cette commande.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    const sent = await interaction.reply({
      components: [buildContainer("## Ping...", COLORS.success)],
      flags: V2_EPHEMERAL,
      withResponse: true,
    });
    const message = sent.resource?.message ?? sent;
    const latency = message.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);
    return interaction.editReply({
      components: [buildContainer(`## Pong\nLatence : **${latency}ms**\nLatence API : **${apiLatency}ms**`, COLORS.success)],
      flags: V2_EPHEMERAL,
    });
  },
};