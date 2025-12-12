// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { parseFeed } from "https://deno.land/x/rss@0.5.6/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const kv = await Deno.openKv();
const TOKEN = Deno.env.get("BOT_TOKEN");
const SECRET_PATH = "/teststore"; // change this if needed
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const CHANNEL = "@testsnewschannel";
const GEMINI_API_KEY = "AIzaSyDArry_xPlyAGz7HBU3qUBsDLxZqS7NfAY";
const RSS_URL = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";
const DOMAIN = "your-deno-deploy-domain.deno.dev"; // Replace with your Deno Deploy domain

serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname !== SECRET_PATH) {
    return new Response("Bot is running.", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const update = await req.json();
  const message = update.message;
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  const text = message?.text;

  if (!userId) return new Response("No user ID", { status: 200 });

  // Helper functions
  async function sendMessage(cid: number | string, txt: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, text: txt, ...opts }),
    });
  }

  async function sendPhoto(cid: number | string, photo: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, photo, ...opts }),
    });
  }

  async function getProfessionalText(desc: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          parts: [
            {
              text: `Rewrite this news summary to make it sound professional, engaging, and suitable for a news channel post. Keep it concise, under 300 words: ${desc}`
            }
          ]
        }
      ]
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        throw new Error(`Gemini API error: ${res.status}`);
      }
      const data = await res.json();
      return data.candidates[0].content.parts[0].text.trim();
    } catch (error) {
      console.error(error);
      return desc; // Fallback to original if Gemini fails
    }
  }

  // Handle /start command
  if (message && text === "/start") {
    try {
      // Fetch and parse RSS
      const rssResponse = await fetch(RSS_URL);
      const xml = await rssResponse.text();
      const feed = await parseFeed(xml);

      if (feed.entries.length === 0) {
        await sendMessage(chatId, "No news found at the moment.");
        return new Response("OK", { status: 200 });
      }

      // Get the hottest (latest) news entry
      const entry = feed.entries[0];
      const title = entry.title?.value || "Untitled";
      let desc = entry.description?.value || "No description available.";
      const link = entry.links[0]?.href || "";

      // Professionalize the description with Gemini
      const proDesc = await getProfessionalText(desc);

      // Fetch article page to extract image
      let imageUrl = "";
      if (link) {
        try {
          const htmlResponse = await fetch(link);
          const html = await htmlResponse.text();
          const document = new DOMParser().parseFromString(html, "text/html");
          const imageMeta = document?.querySelector('meta[property="og:image"]');
          imageUrl = imageMeta?.getAttribute("content") || "";
        } catch (error) {
          console.error("Error fetching image:", error);
        }
      }

      // Prepare caption/content
      const content = `${title}\n\n${proDesc}\n\nSource: ${link}`;

      // Publish to channel
      if (imageUrl) {
        await sendPhoto(CHANNEL, imageUrl, { caption: content, parse_mode: "Markdown" });
      } else {
        await sendMessage(CHANNEL, content, { parse_mode: "Markdown" });
      }

      // Respond to user
      await sendMessage(chatId, "Hottest news has been published to @testsnewschannel!");
    } catch (error) {
      console.error(error);
      await sendMessage(chatId, "An error occurred while fetching and publishing the news.");
    }
  }

  return new Response("OK", { status: 200 });
});
