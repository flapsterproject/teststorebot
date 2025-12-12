// 🤖 Masakoff News Bot - Fetches hottest news on /start from admin, sends raw to admin, formats with Gemini, posts to @testsnewschannel
// 💬 Triggered only by admin in private chat with /start
// 📅 Uses current date for "today's" news
// 📝 Formats with HTML (bold, italic, etc.) and emojis
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@^0.19.0";
// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;
// -------------------- Gemini Setup --------------------
const GEMINI_API_KEY = "AIzaSyCGyDu4yAhEgzTgQkwlF3aDudFZ3f4IaPA";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
// -------------------- Admins --------------------
const ADMINS = ["Masakoff"]; // Add more usernames if needed
// -------------------- Helpers --------------------
async function sendMessage(chatId: string | number, text: string, replyToMessageId?: number) {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_to_message_id: replyToMessageId,
        allow_sending_without_reply: true,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("Failed to send message:", err);
  }
}
// -------------------- Gemini News Functions --------------------
async function getHottestNews(): Promise<string> {
  try {
    const today = new Date().toLocaleDateString("en-US", { timeZone: "UTC" });
    const prompt = `Provide the hottest news stories of today, ${today}. List the top 5 with brief summaries.`;
    const result = await model.generateContent(prompt);
    const text = typeof result.response.text === "function" ? result.response.text() : result.response.text;
    return text || "No news available 😅";
  } catch (err) {
    console.error("Gemini error:", err);
    return "Error fetching news 😅";
  }
}
async function formatNews(raw: string): Promise<string> {
  try {
    const prompt = `Take the following news: "${raw}" and rewrite it as a short and very professional summary. Use different fonts like <b>bold</b> for titles, <i>italic</i> for emphasis or quotes, etc. Decorate with relevant emojis. Format the entire output in HTML suitable for Telegram. Keep it concise.`;
    const result = await model.generateContent(prompt);
    const text = typeof result.response.text === "function" ? result.response.text() : result.response.text;
    return text || "No formatted news available 😅";
  } catch (err) {
    console.error("Gemini error:", err);
    return "Error formatting news 😅";
  }
}
// -------------------- Webhook Handler --------------------
serve(async (req) => {
  try {
    const update = await req.json();
    if (!update?.message && !update?.edited_message) return new Response("ok");
    const msg = update.message || update.edited_message;
    const chatId = String(msg.chat.id);
    const text = msg.text || msg.caption || "";
    const messageId = msg.message_id;
    const username = msg.from?.username || msg.from?.first_name || "unknown";
    const isAdmin = ADMINS.includes(username.replace("@", ""));
    const chatType = msg.chat.type;
    const isPrivate = chatType === "private";
    // --- Handle /start only from admin in private ---
    if (isPrivate && text.trim() === "/start" && isAdmin) {
      const rawNews = await getHottestNews();
      await sendMessage(chatId, rawNews, messageId); // Send raw to admin
      const formattedNews = await formatNews(rawNews);
      await sendMessage("@testsnewschannel", formattedNews); // Post formatted to channel
      await sendMessage(chatId, "✅ News fetched, formatted, and posted to @testsnewschannel!", messageId);
      return new Response("ok");
    }
    // --- Optional: Respond if not authorized ---
    if (isPrivate && text.trim() === "/start" && !isAdmin) {
      await sendMessage(chatId, "🚫 Only admins can use /start!", messageId);
      return new Response("ok");
    }
  } catch (err) {
    console.error("Error handling update:", err);
  }
  return new Response("ok");
});
