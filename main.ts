// main.ts
// 🤖 News Admin Bot for Telegram
// 💬 On /start (from admin in private), fetches hottest news from Gemini, sends full to @Masakoff (admin chat), shortens/decorates with emojis via second Gemini prompt, posts to @testsnewschannel
// 🔒 Only admins can trigger /start
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@^0.19.0";
// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
const API = https://api.telegram.org/bot${TOKEN};
// -------------------- Gemini Setup --------------------
const GEMINI_API_KEY = "AIzaSyCGyDu4yAhEgzTgQkwlF3aDudFZ3f4IaPA";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
// -------------------- Admins --------------------
const ADMINS = ["Masakoff"]; // Add more usernames if needed
// -------------------- Helpers --------------------
async function sendMessage(chatId: string | number, text: string, replyToMessageId?: number) {
  try {
    await fetch(${API}/sendMessage, {
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
// -------------------- News Generators --------------------
async function getHottestNews(): Promise<string> {
  try {
    const prompt = What are the hottest news stories of 2025 year? Provide a detailed summary of the top 3-5 global news items, including key details and sources if possible.;
    const result = await model.generateContent(prompt);
    const text = typeof result.response.text === "function" ? result.response.text() : result.response.text;
    return (text as string) || "🤖 No news available today 😅";
  } catch (err) {
    console.error("Gemini error:", err);
    return "🤖 Error fetching news 😅";
  }
}
async function shortenAndDecorate(fullNews: string): Promise<string> {
  try {
    const prompt = Take this news content and create a short, engaging summary (1-2 paragraphs max),write in russian. Decorate it with relevant emojis to make it fun and visually appealing for a Telegram channel post. Keep it concise and exciting:\n\n${fullNews};
    const result = await model.generateContent(prompt);
    const text = typeof result.response.text === "function" ? result.response.text() : result.response.text;
    return (text as string) || "🤖 No summary available 😅";
  } catch (err) {
    console.error("Gemini error:", err);
    return "🤖 Error creating summary 😅";
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
    // --- Only handle /start in private from admin ---
    if (!isPrivate || text.trim() !== "/start") {
      return new Response("ok");
    }
    if (!isAdmin) {
      await sendMessage(chatId, "🚫 Only admins can use /start!", messageId);
      return new Response("ok");
    }
    // --- Fetch and process news ---
    const fullNews = await getHottestNews();
    await sendMessage(chatId, fullNews, messageId); // Send full news to admin (@Masakoff's private chat)
    const shortNews = await shortenAndDecorate(fullNews);
    await sendMessage("@testsnewschannel", shortNews); // Post short decorated version to channel
  } catch (err) {
    console.error("Error handling update:", err);
  }
  return new Response("ok");
});
