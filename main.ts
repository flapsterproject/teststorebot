// main.ts
// 🤖 Auto Delete Bot for Telegram
// Deletes every new post in any channel the bot is added to after 10 seconds, except for posts from exempt admins: @Masakoff, @InsideAds_bot, @sellbotapp, @MasakoffAdminBot, @Auto_channelpost_bot
// Uses Deno KV for reliable deletion scheduling
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Exempt Admins --------------------
const EXEMPT_ADMINS = ["Masakoff", "InsideAds_bot", "sellbotapp", "MasakoffAdminBot", "Auto_channelpost_bot"];

// -------------------- Deno KV Setup --------------------
const kv = await Deno.openKv();

// -------------------- Deletion Processor --------------------
async function processDeletes() {
  try {
    for await (const entry of kv.list({ prefix: ["deletes"] })) {
      const dueTime = entry.value as number;
      if (dueTime <= Date.now()) {
        const [, chatIdStr, messageId] = entry.key as [string, string, number];
        const chatId = Number(chatIdStr);
        try {
          await fetch(`${API}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
            }),
          });
          console.log(`Deleted message ${messageId} in chat ${chatId}`);
        } catch (deleteErr) {
          console.error(`Failed to delete message ${messageId} in chat ${chatId}:`, deleteErr);
        }
        await kv.delete(entry.key);
      }
    }
  } catch (err) {
    console.error("Error processing deletes:", err);
  }
}

// Run deletion processor every 5 seconds
setInterval(processDeletes, 5000);

// -------------------- Webhook Handler --------------------
serve(async (req) => {
  try {
    const update = await req.json();
    if (!update?.channel_post) return new Response("ok");

    const msg = update.channel_post;
    const chatId = msg.chat.id; // Numeric ID
    const messageId = msg.message_id;
    const from = msg.from;
    const authorSignature = msg.author_signature;

    // --- Only handle new posts in channels ---
    if (msg.chat.type !== "channel") {
      return new Response("ok");
    }

    // --- Determine sender, strip @ if present ---
    let sender = from?.username || authorSignature || null;
    if (sender) {
      sender = sender.replace('@', '');
    }

    console.log(`Received channel post: from.username=${from?.username}, author_signature=${authorSignature}, determined sender=${sender}`);

    // --- Check if sender is exempt ---
    if (sender && EXEMPT_ADMINS.includes(sender)) {
      console.log(`Exempt sender: ${sender}, not deleting message ${messageId}`);
      return new Response("ok"); // Exempt, do not delete
    }

    // --- Schedule deletion in KV (delete after 10 seconds) ---
    const chatIdStr = String(chatId);
    const dueTime = Date.now() + 10000; // 10 seconds from now
    await kv.set(["deletes", chatIdStr, messageId], dueTime);
    console.log(`Scheduled deletion for message ${messageId} in chat ${chatId} at ${new Date(dueTime).toISOString()}`);

  } catch (err) {
    console.error("Error handling update:", err);
  }
  return new Response("ok");
});

// Initial run to clean up any pending deletes
processDeletes();
