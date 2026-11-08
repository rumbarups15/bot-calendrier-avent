const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const COLORS = { error: 0xed4245, info: 0x5865f2 };
const buildContainer = (text, color) => new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
const V2_EPHEMERAL = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const COMMANDS_TEXT = [
  "**/calendrier** définit le salon d'envoi du calendrier",
  "**/cloture** programme la clôture automatique de l'événement",
  "**/calendrier rafraichir** renvoie le calendrier dans le salon",
  "**/rewardconfig definir** définit la récompense d'un jour",
  "**/evenement** lance l'événement",
  "**/stop** arrête l'événement et désactive le calendrier",
  "**/ping** teste la latence du bot",
  "**/help** affiche ce message",
].join("\n");
module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Affiche la liste des commandes du bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({
        components: [buildContainer("## Vous n'avez pas la permission d'utiliser cette commande.", COLORS.error)],
        flags: V2_EPHEMERAL,
      });
    }
    const container = new ContainerBuilder()
      .setAccentColor(COLORS.info)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent("## Liste des commandes"))
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(COMMANDS_TEXT));
    return interaction.reply({
      components: [container],
      flags: V2_EPHEMERAL,
    });
  },
};