// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { v4 as uuid } from "https://deno.land/std@0.224.0/uuid/mod.ts";

const kv = await Deno.openKv();
const TOKEN = Deno.env.get("BOT_TOKEN");
const SECRET_PATH = "/teststore"; // change this if needed
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const ADMIN_USERNAME = "@Masakoff";
const ADSGRAM_BLOCK_ID = "bot-18621"; // Numeric part without bot-
const DOMAIN = "flapsterpro-teststorebo-60.deno.dev"; // Your deploy domain
const CLAIM_PATH = "/claim_reward";

serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === CLAIM_PATH) {
    const id = url.searchParams.get("id");
    if (id) {
      const claimData = (await kv.get(["claim", id])).value;
      if (claimData) {
        const { userId, reward_url, chatId } = claimData;
        const pending = (await kv.get(["pending", userId])).value;
        if (pending) {
          const adminId = (await kv.get(["admin_id"])).value;
          if (adminId) {
            await forwardMessage(adminId, chatId, pending);
            await sendMessage(userId, "Reward claimed successfully! Your message has been sent to the admin.");
          }
          await kv.delete(["pending", userId]);
        }
        await kv.delete(["claim", id]);
        return new Response("", {
          status: 302,
          headers: { Location: reward_url },
        });
      }
    }
    return new Response("Invalid claim", { status: 400 });
  }

  if (pathname !== SECRET_PATH) {
    return new Response("Bot is running.", { status: 200 });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const update = await req.json();
  const message = update.message;
  const callbackQuery = update.callback_query;
  const preCheckoutQuery = update.pre_checkout_query;
  const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;
  const userId = message?.from?.id || callbackQuery?.from?.id || preCheckoutQuery?.from?.id;
  const username = message?.from?.username ? `@${message.from.username}` : (callbackQuery?.from?.username ? `@${callbackQuery.from.username}` : null);
  const text = message?.text;
  const data = callbackQuery?.data;
  const messageId = callbackQuery?.message?.message_id || message?.message_id;
  const callbackQueryId = callbackQuery?.id;
  const preCheckoutQueryId = preCheckoutQuery?.id;
  const languageCode = message?.from?.language_code || "en";
  if (!userId) return new Response("No user ID", { status: 200 });

  // Update user activity if userId exists
  if (userId) {
    const userKey = ["users", userId];
    let userData = (await kv.get(userKey)).value || { registered_at: Date.now(), last_active: Date.now() };
    if (!userData.registered_at) userData.registered_at = Date.now();
    userData.last_active = Date.now();
    await kv.set(userKey, userData);
  }

  // Store admin ID if this is the admin
  if (username === ADMIN_USERNAME) {
    await kv.set(["admin_id"], userId);
  }

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
  async function sendDocument(cid: number | string, document: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, document, ...opts }),
    });
  }
  async function sendVideo(cid: number | string, video: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, video, ...opts }),
    });
  }
  async function forwardMessage(toChatId: string | number, fromChatId: number, msgId: number) {
    await fetch(`${TELEGRAM_API}/forwardMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: msgId }),
    });
  }
  async function answerCallback(qid: string, txt = "") {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: qid, text: txt }),
    });
  }
  async function sendInvoice(cid: number | string, title: string, desc: string, payload: string, currency: string, prices: any[], opts = {}) {
    await fetch(`${TELEGRAM_API}/sendInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, title, description: desc, payload, currency, prices, ...opts }),
    });
  }
  async function answerPreCheckoutQuery(qid: string, ok = true, error = "") {
    await fetch(`${TELEGRAM_API}/answerPreCheckoutQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pre_checkout_query_id: qid, ok, error_message: error }),
    });
  }

  // Handle pre_checkout_query
  if (preCheckoutQuery) {
    await answerPreCheckoutQuery(preCheckoutQueryId, true);
    return new Response("OK", { status: 200 });
  }

  // Handle message updates
  if (message) {
    // Handle successful payment
    if (message.successful_payment) {
      const pending = (await kv.get(["pending", userId])).value;
      if (pending) {
        const adminId = (await kv.get(["admin_id"])).value;
        if (adminId) {
          await forwardMessage(adminId, chatId, pending);
          await sendMessage(chatId, "Payment successful! Your message has been sent to the admin.");
        } else {
          await sendMessage(chatId, "Admin not configured.");
        }
        await kv.delete(["pending", userId]);
      }
      return new Response("OK", { status: 200 });
    }

    if (text?.startsWith("/start")) {
      await sendMessage(chatId, "Send a message to send to admin (@Masakoff)");
    } else if (text || message.photo || message.document || message.video) {
      // Store pending message ID
      await kv.set(["pending", userId], message.message_id);

      // Prepare inline keyboard with pay and ad buttons
      const keyboard = {
        inline_keyboard: [
          [
            { text: "Pay 10 stars", callback_data: "pay" },
            { text: "Rewarded ads", callback_data: "ad" },
          ],
        ],
      };

      // Resend the message content with buttons
      if (text) {
        await sendMessage(chatId, text, { reply_markup: keyboard });
      } else if (message.photo) {
        const photoId = message.photo[message.photo.length - 1].file_id;
        await sendPhoto(chatId, photoId, { caption: message.caption, reply_markup: keyboard });
      } else if (message.document) {
        const docId = message.document.file_id;
        await sendDocument(chatId, docId, { caption: message.caption, reply_markup: keyboard });
      } else if (message.video) {
        const videoId = message.video.file_id;
        await sendVideo(chatId, videoId, { caption: message.caption, reply_markup: keyboard });
      }
    }
  }

  // Handle callback queries
  if (callbackQuery) {
    await answerCallback(callbackQueryId);
    if (data === "pay") {
      const prices = [{ label: "Fee", amount: 10 }];
      await sendInvoice(chatId, "Send Message to Admin", "Pay 10 stars to forward your message to @Masakoff", "send_msg", "XTR", prices);
    } else if (data === "ad") {
      // Fetch ad from Adsgram API
      const adsgramUrl = `https://api.adsgram.ai/advbot?tgid=${userId}&blockid=${ADSGRAM_BLOCK_ID}&language=${languageCode}`;
      const res = await fetch(adsgramUrl);
      if (!res.ok) {
        await sendMessage(chatId, "Failed to load ad.");
        return new Response("OK", { status: 200 });
      }
      const adData = await res.json();
      const { text_html, image_url, click_url, button_name, reward_url, button_reward_name } = adData;

      // Generate unique id for claim
      const uniqueId = uuid.generate();
      await kv.set(["claim", uniqueId], { userId, reward_url, chatId });

      const claimUrl = `https://${DOMAIN}${CLAIM_PATH}?id=${uniqueId}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: button_name, url: click_url },
            { text: button_reward_name, url: claimUrl },
          ],
        ],
      };

      // Send the ad
      if (image_url) {
        await sendPhoto(chatId, image_url, {
          caption: text_html,
          parse_mode: "HTML",
          protect_content: true,
          reply_markup: keyboard,
        });
      } else {
        await sendMessage(chatId, text_html, {
          parse_mode: "HTML",
          protect_content: true,
          reply_markup: keyboard,
        });
      }
    }
  }

  return new Response("OK", { status: 200 });
});
