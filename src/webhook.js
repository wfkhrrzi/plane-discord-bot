const express = require("express");
const fs = require("fs");
const path = require("path");
const { buildIssueEmbeds } = require("./utils/embedBuilder");
const { getIssueUrl } = require("./utils/utils");

function startWebhookServer(client) {
  const app = express();

  // MUST be here or Plane payload fails
  app.use(express.json({ limit: "2mb" }));

  // Optional: browser-friendly check
  app.get("/", (req, res) => {
    res.send("Plane webhook server is running");
  });

  app.post("/plane-webhook", async (req, res) => {
    try {
      console.log("Plane webhook received");
      console.log(JSON.stringify(req.body, null, 2));

      const event = req.body?.event || "unknown.event";
      const issue = req.body.data || {};
      
      const webhookProjectId = issue.project;
      if (!webhookProjectId) {
        console.error("Webhook payload missing project ID");
        return res.status(200).send("OK");
      }

      let channelsConfig = {};
      try {
        const channelsPath = path.join(__dirname, "../data/channels.json");
        if (fs.existsSync(channelsPath)) {
          channelsConfig = JSON.parse(fs.readFileSync(channelsPath, "utf8"));
        }
      } catch (err) {
        console.error("Error reading channels.json:", err);
      }

      const eventType = req.body.event;
      const action = req.body.action;
      const actor = req.body.activity?.actor?.display_name || "Someone";

      // Issue details
      const title = issue.name || "Unknown title";
      
      let workspaceSlug = null;
      for (const channelData of Object.values(channelsConfig)) {
        if (channelData.projectId === webhookProjectId && channelData.workspaceSlug) {
          workspaceSlug = channelData.workspaceSlug;
          break;
        }
      }

      let sequenceId = issue.sequence_id
        ? `${process.env.PROJECT_KEY || "ISSUE"}-${issue.sequence_id}`
        : "N/A";

      if (workspaceSlug && webhookProjectId && issue.sequence_id) {
        try {
          const planeServiceManager = require("./services/PlaneServiceManager");
          const planeService = planeServiceManager.getService(workspaceSlug, webhookProjectId);
          sequenceId = await planeService.formatIssueId(issue.sequence_id);
          issue.formatted_id = sequenceId; // Set formatted_id so embedBuilder uses it directly
        } catch (err) {
          console.error("Failed to format issue ID from Plane API:", err);
        }
      }

      const state = issue.state?.name || "Unknown";
      const priority = issue.priority || "None";

      for (const [key, channelData] of Object.entries(channelsConfig)) {
        if (channelData.projectId === webhookProjectId) {
          const [guildId, channelId] = key.split(":");
          try {
            const channel = await client.channels.fetch(channelId);
            const issueUrl = channelData.workspaceSlug && channelData.projectId
              ? getIssueUrl(
                  channelData.workspaceSlug,
                  channelData.projectId,
                  issue.id,
                )
              : null;

            const embeds = buildIssueEmbeds(issue, issueUrl, null, {
              isWebhook: true,
              action: action,
              actor: actor,
            });

            await channel.send({ embeds });
          } catch (err) {
            console.error(`Failed to send webhook to channel ${channelId}:`, err);
          }
        }
      }

      return res.status(200).send("OK");
    } catch (error) {
      console.error("Webhook processing failed:", error);
      return res.status(200).send("OK");
    }
  });

  // THIS WAS MISSING
  const PORT = process.env.WEBHOOK_PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Plane webhook listener running on port ${PORT}`);
  });
}

module.exports = { startWebhookServer };
