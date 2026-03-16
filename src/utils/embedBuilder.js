const { EmbedBuilder } = require("discord.js");
const logger = require("./logger");
const config = require("../config/config");
const {
  getPriorityEmoji,
  formatState,
  getIssueColor,
  formatDate,
  formatDescription,
  formatLabels,
} = require("./utils");

const formatAttachments = (attachments, planeService) => {
  if (!attachments || attachments.length === 0)
    return { text: "No attachments" };

  if (!planeService) {
    // Basic formatting without planeService
    const parts = attachments.map(
      (a) => `📎 [${a.attributes?.name || a.name || "Attachment"}]`,
    );
    return { text: parts.join("\n") || "Attachments present" };
  }

  const otherAttachments = [];
  attachments.forEach((attachment) => {
    const icon = planeService.getFileIcon(attachment.attributes.name);
    const size = planeService.formatFileSize(attachment.attributes.size);
    otherAttachments.push({
      name: attachment.attributes.name,
      url: `https://${config.API_DOMAIN}/api/assets/v2/workspaces/${planeService.config.WORKSPACE_SLUG}/projects/${planeService.config.PROJECT_ID}/issues/${attachment.issue}/attachments/${attachment.id}`,
      size: size,
      icon: icon,
    });
  });

  const parts = [];
  if (otherAttachments.length > 0) {
    const displayAttachments = otherAttachments.slice(0, 3);
    const remainingCount = otherAttachments.length - 3;

    parts.push(
      displayAttachments
        .map(
          (file) => `${file.icon} [${file.name}](${file.url}) (${file.size})`,
        )
        .join("\n"),
    );

    if (remainingCount > 0) {
      parts.push(
        `\n📎 +${remainingCount} more attachment${
          remainingCount === 1 ? "" : "s"
        }`,
      );
    }
  }

  return {
    text: parts.join("\n") || "No attachments",
  };
};

const formatMetadata = (issue) => {
  const parts = [];
  if (issue.created_at) {
    parts.push(`📅 Created: ${formatDate(issue.created_at)}`);
  }
  if (issue.updated_at && issue.updated_at !== issue.created_at) {
    parts.push(`🔄 Updated: ${formatDate(issue.updated_at)}`);
  }
  return parts.join(" • ");
};

const buildIssueEmbeds = (
  issue,
  issueUrl,
  planeService = null,
  options = {},
) => {
  const { isWebhook = false, action = null, actor = null } = options;

  let formattedId = issue.formatted_id;
  if (!formattedId && issue.sequence_id) {
    formattedId = `${process.env.PROJECT_KEY || "ISSUE"}-${issue.sequence_id}`;
  }

  const idPrefix = formattedId ? `${formattedId} ` : "";
  const baseTitle = `${idPrefix}${issue.name || "Untitled Issue"}`;
  const title = isWebhook ? `[WEBHOOK] ${baseTitle}` : baseTitle;

  const mainEmbed = new EmbedBuilder()
    .setTitle(title)
    .setColor(getIssueColor(issue))
    .setFooter({ text: formatMetadata(issue) })
    .setTimestamp();

  if (issueUrl) {
    mainEmbed.setURL(issueUrl);
  }

  let description = "";
  if (isWebhook && action) {
    description += `**Action:** ${action.toUpperCase()}${actor ? ` by ${actor}` : ""}\n\n`;
  }

  description += formatDescription(issue.description_stripped);

  if (description) {
    mainEmbed.setDescription(description);
  }

  const resolveAssignees = () => {
    let arr = issue.assignee_details || issue.assignees || [];
    if (!Array.isArray(arr)) return "Unassigned";
    const mapped = arr
      .map((a) =>
        typeof a === "object"
          ? a.display_name || a.first_name || a.username
          : a,
      )
      .filter(Boolean);
    return mapped.length > 0 ? mapped.join(", ") : "Unassigned";
  };

  const assigneesStr = resolveAssignees();
  const stateName = issue.state_detail?.name || issue.state?.name || "Unknown";
  const stateGroup = issue.state_detail?.group || issue.state?.group;

  mainEmbed.addFields({
    name: "Status",
    value: [
      `**Priority:** ${getPriorityEmoji(issue.priority)} ${
        issue.priority?.toUpperCase() || "None"
      }`,
      `**State:** ${formatState(stateName, stateGroup)}`,
      `**Assigned to:** ${assigneesStr}`,
    ].join("\n"),
    inline: false,
  });

  const embeds = [mainEmbed];

  if (issue.attachments?.length > 0) {
    logger.debug("Processing attachments", {
      count: issue.attachments.length,
    });

    const { text } = formatAttachments(issue.attachments, planeService);
    logger.info("Attachments processed", {
      text: text === "No attachments" ? text : "yes",
    });
    if (text !== "No attachments") {
      mainEmbed.addFields({
        name: "📁 Attachments",
        value: text,
        inline: false,
      });
    }
  }

  if (issueUrl) {
    mainEmbed.addFields({
      name: "🔗 Quick Actions",
      value: `[View in Plane](${issueUrl})`,
      inline: false,
    });
  }

  const labels = issue.label_details || issue.labels;
  if (labels?.length > 0) {
    logger.debug("Processing labels", {
      count: labels.length,
    });

    const labelFields = formatLabels(labels);
    if (labelFields.length > 0) {
      const labelsEmbed = new EmbedBuilder()
        .setColor(0x6b7280)
        .setTitle("Labels");

      labelFields.forEach((field) => {
        labelsEmbed.addFields({
          name: field.name,
          value: field.value,
          inline: true,
        });
      });

      embeds.push(labelsEmbed);
    }
  }

  return embeds;
};

module.exports = {
  buildIssueEmbeds,
  formatAttachments,
  formatMetadata,
};
