// main.ts
// 🤖 Auto Delete Bot for Telegram
// Deletes every new post by admins in any channel the bot is added to after 1 minute, except for exempt admins: @Masakoff, @InsideAds_bot, @sellbotapp, @MasakoffAdminBot, @Auto_channelpost_bot
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Exempt Admins --------------------
const EXEMPT_ADMINS = ["Masakoffa", "InsideAds_bot", "sellbotapp", "MasakoffAdminBot", "Auto_channelpost_bot"];

// -------------------- Webhook Handler --------------------
serve(async (req) => {
  try {
    const update = await req.json();
    if (!update?.channel_post) return new Response("ok");

    const msg = update.channel_post;
    const chatId = msg.chat.id; // Numeric ID
    const messageId = msg.message_id;
    const from = msg.from;

    // --- Only handle new posts in channels ---
    if (msg.chat.type !== "channel") {
      return new Response("ok");
    }

    // --- Check if sender exists and is not exempt ---
    if (!from || !from.username) {
      return new Response("ok"); // Anonymous or no sender
    }

    const username = from.username;
    if (EXEMPT_ADMINS.includes(username)) {
      return new Response("ok"); // Exempt, do not delete
    }

    // --- Schedule deletion after 1 minute (60000 ms) ---
    setTimeout(async () => {
      try {
        await fetch(`${API}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
          }),
        });
      } catch (err) {
        console.error("Failed to delete message:", err);
      }
    }, 60000);

  } catch (err) {
    console.error("Error handling update:", err);
  }
  return new Response("ok");
});

