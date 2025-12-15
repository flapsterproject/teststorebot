// main.ts
// 🤖 Auto Delete Bot for Telegram
// Deletes every new post in any channel the bot is added to after 10 seconds if the post does not contain at least one of the specified keywords (case-insensitive)
// Uses Deno KV for reliable deletion scheduling
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Keywords to Keep --------------------
const KEEP_KEYWORDS = ["InsideAds", "Kod işläp dur like gysganmaň", "☄️ Пинг: 100–300 мс", "#реклама", "Перейти"];

// -------------------- Deno KV Setup --------------------
const kv = await Deno.openKv();

// -------------------- Deletion Processor --------------------
async function processDeletes() {
  try {
    for await (const entry of kv.list({ prefix: ["deletes"] })) {
      const dueTime = entry.value as number;
      if (dueTime <= Date.now()) {
        const [, chatIdStr, messageIdStr] = entry.key as [string, string, string];
        const chatId = Number(chatIdStr);
        const messageId = Number(messageIdStr);
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
    const text = (msg.text || msg.caption || "").toLowerCase();
    // --- Only handle new posts in channels ---
    if (msg.chat.type !== "channel") {
      return new Response("ok");
    }
    console.log(`Received channel post: text=${text.substring(0, 50)}...`);
    // --- Check if text contains at least one keep keyword (case-insensitive) ---
    const hasKeyword = KEEP_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
    if (hasKeyword) {
      console.log(`Message ${messageId} contains keep keyword, not deleting`);
      return new Response("ok"); // Has keyword, do not delete
    }
    // --- Schedule deletion in KV (delete after 10 seconds) ---
    const chatIdStr = String(chatId);
    const messageIdStr = String(messageId);
    const dueTime = Date.now() + 10000; // 10 seconds from now
    await kv.set(["deletes", chatIdStr, messageIdStr], dueTime);
    console.log(`Scheduled deletion for message ${messageId} in chat ${chatId} at ${new Date(dueTime).toISOString()}`);
  } catch (err) {
    console.error("Error handling update:", err);
  }
  return new Response("ok");
});

// Initial run to clean up any pending deletes
processDeletes();
