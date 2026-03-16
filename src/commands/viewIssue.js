const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger");
const config = require("../config/config");
const {
  getIssueUrl,
} = require("../utils/utils");

const { buildIssueEmbeds } = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("view-issue")
    .setDescription("View details of a specific issue")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("The sequence ID of the issue (e.g., PROJ-123)")
        .setRequired(true)
    ),

  async execute(interaction, { planeService, channelConfig }) {
    // Check if channel is configured
    if (!planeService || !channelConfig) {
      const notConfiguredEmbed = new EmbedBuilder()
        .setTitle("⚠️ Channel Not Configured")
        .setDescription(
          "This channel is not configured for Plane.\n" +
            "An administrator must use `/plane-setup` to configure this channel first."
        )
        .setColor(0xfbbf24)
        .setTimestamp();

      await interaction.reply({ embeds: [notConfiguredEmbed], ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      const sequenceId = interaction.options.getString("id").toUpperCase();

      logger.info("View issue command initiated", {
        user: interaction.user.tag,
        guild: interaction.guild?.name,
        workspace: channelConfig.workspaceSlug,
        project: channelConfig.projectId,
        issueId: sequenceId,
      });

      // Show progress
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏳ Fetching Issue...")
            .setDescription(
              "Please wait while the issue details are being fetched."
            )
            .setColor(0xfbbf24)
            .setTimestamp(),
        ],
      });

      const issue = await planeService.getIssueBySequenceId(sequenceId);

      logger.debug("Issue fetched successfully", {
        issueId: issue.id,
        hasAttachments: issue.attachments?.length > 0,
        hasLabels: issue.label_details?.length > 0,
      });

      const issueUrl = getIssueUrl(
        planeService.config.WORKSPACE_SLUG,
        planeService.config.PROJECT_ID,
        issue.id
      );

      // Resolve assignee IDs to names
      try {
        const allMembers = await planeService.getProjectMembers();
        const assigneeArray =
          issue.assignee_details || issue.assignees || issue.assignee_ids || [];

        if (Array.isArray(assigneeArray) && assigneeArray.length > 0) {
          issue.assignee_details = assigneeArray.map((assignee) => {
            if (typeof assignee === "object" && assignee !== null) {
              return assignee;
            }
            const id = String(assignee);
            if (allMembers[id]) {
              return { display_name: allMembers[id].name || id };
            }
            return assignee;
          });
        }
      } catch (err) {
        logger.warn("Failed to resolve assignees", err);
      }

      const embeds = buildIssueEmbeds(issue, issueUrl, planeService);

      logger.info("Issue details displayed successfully", {
        issueId: issue.id,
        embedCount: embeds.length,
      });

      await interaction.editReply({ embeds });
    } catch (error) {
      logger.error("Error viewing issue", error);

      const errorEmbed = new EmbedBuilder()
        .setTitle("❌ Failed to View Issue")
        .setDescription(
          error.message ||
            "An unexpected error occurred while fetching the issue."
        )
        .setColor(0xdc2626)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
