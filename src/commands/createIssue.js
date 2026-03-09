const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger");
const PlaneService = require("../services/planeApi");
const config = require("../config/config");
const {
  getPriorityEmoji,
  getIssueUrl,
  getPriorityColor,
  formatDate,
} = require("../utils/utils");

function getColorEmoji(hex) {
  if (!hex) return "🏷️";
  hex = hex.toLowerCase();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  if (hex.length !== 6) return "🏷️";

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  if (r > 200 && g < 100 && b < 100) return "🔴";
  if (r < 100 && g > 200 && b < 100) return "🟢";
  if (r < 100 && g < 100 && b > 200) return "🔵";
  if (r > 200 && g > 200 && b < 100) return "🟡";
  if (r > 150 && g < 100 && b > 150) return "🟣";
  if (r > 200 && g > 100 && b < 100) return "🟠";
  if (r < 100 && g > 150 && b > 150) return "🩵";
  if (r < 50 && g < 50 && b < 50) return "⚫";
  if (r > 200 && g > 200 && b > 200) return "⚪";

  return "🔹";
}

module.exports = {
  data: (async () => {
    const commandBuilder = new SlashCommandBuilder()
      .setName("create-issue")
      .setDescription("Create a new issue")
      .addStringOption((option) =>
        option.setName("title").setDescription("Issue title").setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("description")
          .setDescription("Issue description")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("priority")
          .setDescription("Issue priority")
          .setRequired(false)
          .addChoices(
            { name: "Urgent", value: "urgent" },
            { name: "High", value: "high" },
            { name: "Medium", value: "medium" },
            { name: "Low", value: "low" },
          ),
      );

    try {
      if (config.WORKSPACE_SLUG && config.PROJECT_ID && config.PLANE_API_KEY) {
        const globalPlaneService = new PlaneService(
          config.WORKSPACE_SLUG,
          config.PROJECT_ID,
        );

        const [states, labels, members] = await Promise.all([
          globalPlaneService.getStates(),
          globalPlaneService.getLabels(),
          globalPlaneService.getProjectMembers(),
        ]);

        const stateChoices = Object.values(states || {})
          .slice(0, 25)
          .map((s) => ({ name: s.name.substring(0, 100), value: s.id }));
        const labelChoices = Object.values(labels || {})
          .slice(0, 25)
          .map((l) => ({ name: l.name.substring(0, 100), value: l.id }));
        const memberChoices = Object.values(members || {})
          .slice(0, 25)
          .map((m) => ({
            name: (m.name || m.id).substring(0, 100),
            value: m.id,
          }));

        if (stateChoices.length > 0) {
          commandBuilder.addStringOption((option) =>
            option
              .setName("state")
              .setDescription("Issue state")
              .setRequired(false)
              .addChoices(...stateChoices),
          );
        } else {
          commandBuilder.addStringOption((option) =>
            option
              .setName("state")
              .setDescription("Issue state ID")
              .setRequired(false),
          );
        }

        if (labelChoices.length > 0) {
          commandBuilder.addStringOption((option) =>
            option
              .setName("labels")
              .setDescription("Issue label")
              .setRequired(false)
              .addChoices(...labelChoices),
          );
        } else {
          commandBuilder.addStringOption((option) =>
            option
              .setName("labels")
              .setDescription("Issue label ID")
              .setRequired(false),
          );
        }

        if (memberChoices.length > 0) {
          commandBuilder.addStringOption((option) =>
            option
              .setName("assignees")
              .setDescription("Assignee")
              .setRequired(false)
              .addChoices(...memberChoices),
          );
        } else {
          commandBuilder.addStringOption((option) =>
            option
              .setName("assignees")
              .setDescription("Assignee user ID")
              .setRequired(false),
          );
        }
      } else {
        commandBuilder.addStringOption((option) =>
          option
            .setName("state")
            .setDescription("Issue state ID")
            .setRequired(false),
        );
        commandBuilder.addStringOption((option) =>
          option
            .setName("labels")
            .setDescription("Issue label ID")
            .setRequired(false),
        );
        commandBuilder.addStringOption((option) =>
          option
            .setName("assignees")
            .setDescription("Assignee user ID")
            .setRequired(false),
        );
      }
    } catch (e) {
      logger.error("Failed to fetch choices dynamically", e);
      commandBuilder.addStringOption((option) =>
        option
          .setName("state")
          .setDescription("Issue state ID")
          .setRequired(false),
      );
      commandBuilder.addStringOption((option) =>
        option
          .setName("labels")
          .setDescription("Issue label ID")
          .setRequired(false),
      );
      commandBuilder.addStringOption((option) =>
        option
          .setName("assignees")
          .setDescription("Assignee user ID")
          .setRequired(false),
      );
    }

    commandBuilder
      .addStringOption((option) =>
        option
          .setName("start_date")
          .setDescription("Start date (YYYY-MM-DD)")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("target_date")
          .setDescription("Target date (YYYY-MM-DD)")
          .setRequired(false),
      );

    return commandBuilder;
  })(),

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
      logger.info("Creating new issue command initiated", {
        user: interaction.user.tag,
        guild: interaction.guild?.name,
        workspace: channelConfig.workspaceSlug,
        project: channelConfig.projectId,
      });

      const title = interaction.options.getString("title");
      const description = interaction.options.getString("description") || "";
      const priority = interaction.options.getString("priority") || "none";
      const state = interaction.options.getString("state");
      const label = interaction.options.getString("labels");
      const assignee = interaction.options.getString("assignees");
      const start_date = interaction.options.getString("start_date");
      const target_date = interaction.options.getString("target_date");

      logger.debug("Issue creation parameters", {
        title,
        description: description ? "Provided" : "Not provided",
        priority,
      });

      // Show progress
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏳ Creating Issue...")
            .setDescription("Please wait while the issue is being created.")
            .setColor(0xfbbf24)
            .setTimestamp(),
        ],
      });

      const issue = await planeService.createIssue(
        title,
        description,
        priority !== "none" ? priority : "none",
        state,
        label ? [label] : null,
        assignee ? [assignee] : null,
        start_date,
        target_date,
      );

      logger.info("Issue created successfully", {
        issueId: issue.id,
        sequenceId: issue.sequence_id,
      });

      const latestIssue = await planeService.getIssueById(issue.id);

      const [allStates, allLabels, allMembers] = await Promise.all([
        planeService.getStates(),
        planeService.getLabels(),
        planeService.getProjectMembers(),
      ]);

      const issueUrl = getIssueUrl(
        planeService.config.WORKSPACE_SLUG,
        planeService.config.PROJECT_ID,
        issue.id,
      );

      // Extract new params for embed display
      let stateDisplay = "None";
      if (latestIssue.state_detail) {
        const stateColor = latestIssue.state_detail.color;
        const icon = getColorEmoji(stateColor);
        stateDisplay = `${icon} ${latestIssue.state_detail.name}`;
      }

      let labelsDisplay = "None";
      if (latestIssue.label_details && latestIssue.label_details.length > 0) {
        labelsDisplay = latestIssue.label_details
          .map((l) => `${getColorEmoji(l.color)} ${l.name}`)
          .join(", ");
      }

      let assigneeDisplay = "None";
      if (assignee) {
        assigneeDisplay = allMembers[assignee]
          ? allMembers[assignee].name
          : assignee;
      } else if (issue.assignee_ids && issue.assignee_ids.length > 0) {
        // Fallback or API automatically assigned someone
        const firstAssignee = issue.assignee_ids[0];
        assigneeDisplay = allMembers[firstAssignee]
          ? allMembers[firstAssignee].name
          : firstAssignee;
      }

      // Create success embed
      const successEmbed = new EmbedBuilder()
        .setTitle("✅ Issue Created Successfully")
        .setColor(getPriorityColor(priority))
        .setDescription(`>>> ${title}`)
        .addFields(
          {
            name: "Issue Details",
            value: [
              `**ID:** ${latestIssue.formatted_id}`,
              `**Priority:** ${getPriorityEmoji(priority)} ${priority.toUpperCase()}`,
              `**State:** ${stateDisplay}`,
              `**Labels:** ${labelsDisplay}`,
              `**Assignee:** ${assigneeDisplay}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Dates",
            value: [
              `**Start Date:** ${start_date ? start_date : "None"}`,
              `**Target Date:** ${target_date ? target_date : "None"}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Description",
            value: `${
              description.length > 100
                ? description.substring(0, 97) + "..."
                : description || "No description provided."
            }`,
            inline: false,
          },
          {
            name: "🔗 Quick Actions",
            value: `[View in Plane](${issueUrl})`,
            inline: false,
          }
        )
        .setFooter({ text: `📅 Created: ${formatDate(issue.created_at)}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
    } catch (error) {
      logger.error("Error creating issue", error);

      const errorEmbed = new EmbedBuilder()
        .setTitle("❌ Failed to Create Issue")
        .setDescription(
          error.message ||
            "An unexpected error occurred while creating the issue."
        )
        .setColor(0xdc2626)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
