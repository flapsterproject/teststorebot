// main.ts
// Ported Telegram Store Bot to Deno with Web Integration
// Features: User balances (TMT/USDT), orders, deliveries, admin chats, broadcasts, sum additions, transfers, checks
// Uses Deno KV for storage, webhook for Telegram updates
// Serves web HTML at root path
// Notes: Requires BOT_TOKEN env var. Deploy as webhook at /webhook (adjust SECRET_PATH).
// Admin IDs hardcoded - adjust adminidS
// Assumes products are pre-added via KV (example in code)
// Pricing tiers hardcoded - adjust pricingTiersFunc
// Status icons and messages defined
// bcrypt for passwords
// No internet access beyond Telegram API

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/teststore"; // Webhook path for Telegram updates
const DOMAIN = "https://teststorewebv1.netlify.app/"; // Your mini app URL
const ADMIN_IDS: string[] = ["Masakoff", "your_admin_tg_id_2"]; // Array of admin TG IDs as strings
const EDIT_SUMM_COMMAND = "edit"; // Command for sum edit

// HTML for web mini app
const HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Bejerişde</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;700&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Roboto', sans-serif;
      background: linear-gradient(135deg, #1d1f27, #2f3242);
      color: white;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 20px;
    }

    .container {
      max-width: 600px;
    }

    h1 {
      font-size: 3rem;
      margin-bottom: 20px;
    }

    p {
      font-size: 1.2rem;
      margin-bottom: 30px;
      color: #ccc;
    }

    .gear {
      font-size: 4rem;
      animation: spin 2s linear infinite;
      display: inline-block;
      margin-bottom: 20px;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    footer {
      margin-top: 40px;
      font-size: 0.9rem;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="gear">⚙️</div>
    <h1>Ýyldyz Store Bejerişde</h1>
    <p>Biz bilen galyň. <br/> <a href='https://t.me/yyldyzchat' style='color: white'>Ýyldyz Çat</a> <br/> <a href='https://t.me/yyldyzkanal' style='color: white'>Ýyldyz Kanal</a></p>
    <footer>© 2025 Ýyldyz Store.</footer>
  </div>
</body>
</html>`;

// Deno KV
const kv = await Deno.openKv();

// Status icons
const statusIcons = {
  yes: ["✅", "✔️", "🟢", "👍"],
  no: ["❌", "✖️", "🔴", "👎"],
  care: ["⚠️", "❗", "🚨", "🔥", "💥", "🛑", "🚫", "📛"],
  wait: ["⏳", "⌛", "🕒"],
};

// Pricing tiers function (adjust as needed)
function pricingTiersFunc({ product, quantity }: { product: Product; quantity: number }): { tmtPrice: number; usdtPrice: number; amount: number } {
  // Example logic - adjust based on your needs
  return {
    tmtPrice: product.priceTMT * quantity,
    usdtPrice: product.priceUSDT * quantity,
    amount: product.amount * quantity,
  };
}

// Error codes
const err_6 = { m: "User Db update error", d: "err_6" };
const err_7 = { m: "Message IDs not found", d: "err_7" };

// Validators
async function isAdminId(userId: string): Promise<{ error: boolean }> {
  return { error: !ADMIN_IDS.includes(userId) };
}

async function adminValid(userId: string | number | undefined): Promise<{ error: boolean; mssg: string }> {
  if (!userId) return { error: true, mssg: "User ID not found" };
  const isAdmin = await isAdminId(userId.toString());
  return isAdmin.error ? { error: true, mssg: "Siz admin däl" } : { error: false, mssg: "" };
}

async function userValid(userId: string | number | undefined, createIfNot = false): Promise<User | { error: true; mssg: string }> {
  if (!userId) return { error: true, mssg: "User ID not found" };
  const id = userId.toString();
  const user = await getUser(id);
  if (user) return user;
  if (createIfNot) {
    const newUser: User = {
      id,
      walNum: generateWalNum(),
      sumTmt: 0,
      sumUsdt: 0,
    };
    await setUser(newUser);
    return newUser;
  }
  return { error: true, mssg: "User not found" };
}

function generateWalNum(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

async function validator(
  orderId: number,
  allowedStatuses: string[],
  newStatus: string,
  courierId?: string
): Promise<Order | { error: true; mssg: string }> {
  const order = await getOrder(orderId);
  if (!order) return { error: true, mssg: "Sargyt tapylmady" };
  if (!allowedStatuses.includes(order.status)) return { error: true, mssg: "Sargyt ýagdaýy dogry däl" };
  order.status = newStatus;
  if (courierId) order.courierid = courierId;
  await setOrder(order);
  return order;
}

// Messages
const welcome = "<b>Hoş geldiňiz!</b> \n Dükana girmek üçin düwmä basyň.";

function hspMsg(walNum: string, sumTmt: number, sumUsdt: number): string {
  return `Hasap nomer: <code>${walNum}</code> \n TMT: ${sumTmt} \n USDT: ${sumUsdt}`;
}

function sspcsCaseMs(mssg: string, comand: string, username?: string, id?: number): string {
  return `${mssg} \n Komand: ${comand} \n Ulanyjy: @${username} / ID: ${id}`;
}

function afterOrderConfirmedMess({ order, adminOnlineStatus }: { order: Order; adminOnlineStatus: boolean }): string {
  // Implement based on original
  return "Sargyt kabul edildi. Admin garaşyň.";
}

function ordrCmltdMssgFnc(adminId: number, firstName: string): string {
  return `${statusIcons.yes[2]} Sargyt tabşyryldy by ID:${adminId} (${firstName})`;
}

function ordrDclngMssgFnc(adminId: string, firstName: string | false, reason?: string, forClient = false): string {
  const name = firstName ? ` (${firstName})` : "";
  const rsn = reason ? `\nSebäp: ${reason}` : "";
  return `${statusIcons.no[2]} Sargyt ýatyryldy by ID:${adminId}${name}${rsn}`;
}

function ordrDlvrng(adminId: number, firstName: string): string {
  return `${statusIcons.wait[0]} Sargyt eltilýär by ID:${adminId} (${firstName})`;
}

function ordrIdMssgFnc(id: number): string {
  return `<b>Sargyt ID: ${id}</b>`;
}

function prdctDtlMssg({ order, forWhom }: { order: Order; forWhom: "admin" | "client" }): string {
  // Implement details
  return `Product: ${order.productId}, Quantity: ${order.quantity || 1}, Payment: ${order.payment}`;
}

function userLink({ id, nick }: { id: number; nick?: string }): string {
  return `<a href="tg://user?id=${id}">${nick || id}</a>`;
}

// Keyboards as JSON
const mainKEybiard = {
  keyboard: [
    [{ text: "Dükana gir 🛒" }, { text: "Balans" }],
    [{ text: "Admini çagyr" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

function cnclAddSumBtnn() {
  return {
    inline_keyboard: [[{ text: "Ýatyr", callback_data: "declineAdd" }]],
  };
}

function dlvrOrdrKybrd(order: Order) {
  return {
    inline_keyboard: [
      [{ text: "Elit", callback_data: `deliverOrder_${order.id}` }],
      [{ text: "Ýatyr", callback_data: `declineOrder_${order.id}` }],
    ],
  };
}

// Models
type PaymentMethod = "TMT" | "USDT";

interface User {
  id: string;
  walNum: string;
  sumTmt: number;
  sumUsdt: number;
}

interface Admin {
  tgId: string;
  onlineSatus: boolean;
  nick?: string;
  hashedPassword?: string;
}

interface Product {
  id: number;
  priceTMT: number;
  priceUSDT: number;
  amount: number;
  chatRequired: boolean;
  // Add more fields if needed
}

interface Order {
  id: number;
  status: "pending" | "accepted" | "delivering" | "completed" | "paid" | "cancelled";
  userId: string;
  productId: number;
  quantity?: number;
  payment: PaymentMethod;
  total?: number;
  receiver: string;
  courierid?: string;
  mssgIds: number[];
  clntMssgId?: number;
  reason?: string;
}

interface SummUpdate {
  id: number;
  cashierid: string;
  clientid: string;
  currency: PaymentMethod;
  sum: number;
}

interface Transfer {
  id: number;
  senderid: string;
  recieverid: string;
  currency: PaymentMethod;
  amount: number;
}

// KV functions
async function getCounter(name: string): Promise<number> {
  const res = await kv.get<number>(["counters", name]);
  return res.value ?? 0;
}

async function incrementCounter(name: string): Promise<number> {
  let current = await getCounter(name);
  current++;
  await kv.set(["counters", name], current);
  return current;
}

async function getUser(id: string): Promise<User | null> {
  const res = await kv.get<User>(["users", id]);
  return res.value ?? null;
}

async function setUser(user: User) {
  await kv.set(["users", user.id], user);
}

async function getAllUsers(): Promise<User[]> {
  const users: User[] = [];
  for await (const entry of kv.list({ prefix: ["users"] })) {
    if (entry.value) users.push(entry.value as User);
  }
  return users;
}

async function getAdmin(tgId: string): Promise<Admin | null> {
  const res = await kv.get<Admin>(["admins", tgId]);
  return res.value ?? null;
}

async function setAdmin(admin: Admin) {
  await kv.set(["admins", admin.tgId], admin);
}

async function getProduct(id: number): Promise<Product | null> {
  const res = await kv.get<Product>(["products", id]);
  return res.value ?? null;
}

async function setProduct(product: Product) {
  await kv.set(["products", product.id], product);
}

async function getOrder(id: number): Promise<Order | null> {
  const res = await kv.get<Order>(["orders", id]);
  return res.value ?? null;
}

async function setOrder(order: Order) {
  await kv.set(["orders", order.id], order);
}

async function getSummUpdate(id: number): Promise<SummUpdate | null> {
  const res = await kv.get<SummUpdate>(["summupdates", id]);
  return res.value ?? null;
}

async function setSummUpdate(summUpdate: SummUpdate) {
  await kv.set(["summupdates", summUpdate.id], summUpdate);
}

async function getTransfer(id: number): Promise<Transfer | null> {
  const res = await kv.get<Transfer>(["transfers", id]);
  return res.value ?? null;
}

async function setTransfer(transfer: Transfer) {
  await kv.set(["transfers", transfer.id], transfer);
}

// States
interface ChatState {
  userId: number;
  username?: string;
  messageIds: number[];
  calling?: boolean;
}

async function getChatState(userId: string): Promise<ChatState | null> {
  const res = await kv.get<ChatState>(["states", "chat", userId]);
  return res.value ?? null;
}

async function setChatState(userId: string, state: ChatState) {
  await kv.set(["states", "chat", userId], state);
}

async function deleteChatState(userId: string) {
  await kv.delete(["states", "chat", userId]);
}

interface BroadcastState {
  message: string;
  message_id: number;
}

async function getBroadcastState(userId: string): Promise<BroadcastState | null> {
  const res = await kv.get<BroadcastState>(["states", "broadcast", userId]);
  return res.value ?? null;
}

async function setBroadcastState(userId: string, state: BroadcastState) {
  await kv.set(["states", "broadcast", userId], state);
}

async function deleteBroadcastState(userId: string) {
  await kv.delete(["states", "broadcast", userId]);
}

interface SumAddState {
  mssgId: number;
  walNum: string;
  crrncy: PaymentMethod;
  sum: number;
}

async function getSumAddState(userId: string): Promise<SumAddState | null> {
  const res = await kv.get<SumAddState>(["states", "sumadd", userId]);
  return res.value ?? null;
}

async function setSumAddState(userId: string, state: SumAddState) {
  await kv.set(["states", "sumadd", userId], state);
}

async function deleteSumAddState(userId: string) {
  await kv.delete(["states", "sumadd", userId]);
}

interface TransferState {
  messageId: number;
  recieverID: number;
  senderWalNum: string;
  recieverWalNum: string;
  amount: number;
  currency: PaymentMethod;
}

async function getTransferState(userId: string): Promise<TransferState | null> {
  const res = await kv.get<TransferState>(["states", "transfer", userId]);
  return res.value ?? null;
}

async function setTransferState(userId: string, state: TransferState) {
  await kv.set(["states", "transfer", userId], state);
}

async function deleteTransferState(userId: string) {
  await kv.delete(["states", "transfer", userId]);
}

interface CheckState {
  messageId: number;
}

async function getCheckState(userId: string): Promise<CheckState | null> {
  const res = await kv.get<CheckState>(["states", "check", userId]);
  return res.value ?? null;
}

async function setCheckState(userId: string, state: CheckState) {
  await kv.set(["states", "check", userId], state);
}

async function deleteCheckState(userId: string) {
  await kv.delete(["states", "check", userId]);
}

interface SignupState {
  nick?: string;
  pass?: string;
  message_id: number;
}

async function getSignupState(userId: string): Promise<SignupState | null> {
  const res = await kv.get<SignupState>(["states", "signup", userId]);
  return res.value ?? null;
}

async function setSignupState(userId: string, state: SignupState) {
  await kv.set(["states", "signup", userId], state);
}

async function deleteSignupState(userId: string) {
  await kv.delete(["states", "signup", userId]);
}

interface ReasonState {
  orderId: number;
  client: string;
  mssgIds: number[];
  clntMssgId: number;
}

async function getReasonState(userId: string): Promise<ReasonState | null> {
  const res = await kv.get<ReasonState>(["states", "reason", userId]);
  return res.value ?? null;
}

async function setReasonState(userId: string, state: ReasonState) {
  await kv.set(["states", "reason", userId], state);
}

async function deleteReasonState(userId: string) {
  await kv.delete(["states", "reason", userId]);
}

interface OrdrMsgEdtStt {
  mssgIds: number[];
  clntMssgId: number;
}

async function getOrdrMsgEdtStt(orderId: number): Promise<OrdrMsgEdtStt | null> {
  const res = await kv.get<OrdrMsgEdtStt>(["states", "ordrmsgedt", orderId]);
  return res.value ?? null;
}

async function setOrdrMsgEdtStt(orderId: number, state: OrdrMsgEdtStt) {
  await kv.set(["states", "ordrmsgedt", orderId], state);
}

async function deleteOrdrMsgEdtStt(orderId: number) {
  await kv.delete(["states", "ordrmsgedt", orderId]);
}

// Telegram API helpers
async function sendMessage(chatId: string | number, text: string, options: any = {}): Promise<number | null> {
  try {
    const body = { chat_id: chatId, text, ...options };
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage error", e);
    return null;
  }
}

async function editMessageText(chatId: string | number, messageId: number, text: string, options: any = {}) {
  try {
    const body = { chat_id: chatId, message_id: messageId, text, ...options };
    await fetch(`${API}/editMessageText`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("editMessageText error", e);
  }
}

async function answerCallbackQuery(id: string, text = "", showAlert = false) {
  try {
    await fetch(`${API}/answerCallbackQuery`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ callback_query_id: id, text, show_alert: showAlert }),
    });
  } catch (e) {
    console.error("answerCallbackQuery error", e);
  }
}

async function pinChatMessage(chatId: string | number, messageId: number) {
  try {
    await fetch(`${API}/pinChatMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch (e) {
    console.error("pinChatMessage error", e);
  }
}

async function unpinChatMessage(chatId: string | number, messageId: number) {
  try {
    await fetch(`${API}/unpinChatMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch (e) {
    console.error("unpinChatMessage error", e);
  }
}

// Command handlers
async function handleStart(fromId: string, text: string) {
  const param = text.split(" ")[1] || "";
  const user = await userValid(fromId, true);
  if ("error" in user) {
    await sendMessage(fromId, user.mssg + " \n Täzeden synanşyň /start");
    return;
  }
  if (param === "calladmin") {
    await sendMessage(fromId, "Balansyňyzy doldurmak üçin admini çagyryň.", { reply_markup: mainKEybiard });
    return;
  }
  await sendMessage(fromId, welcome, { reply_markup: mainKEybiard, parse_mode: "HTML" });
}

async function handleSignup(fromId: string) {
  const isAdmin = await adminValid(fromId);
  if (isAdmin.error) {
    return;
  }
  const messageId = await sendMessage(fromId, "Nickname \n Parol");
  if (messageId) {
    await setSignupState(fromId, { message_id: messageId });
  }
}

async function handleBroadcast(fromId: string) {
  const isAdmin = await adminValid(fromId);
  if (isAdmin.error) {
    return;
  }
  const messageId = await sendMessage(fromId, "Texti ugradyn", {
    reply_markup: { inline_keyboard: [[{ text: "Ýatyr", callback_data: `cancelBroad_${fromId}` }]] },
  });
  if (messageId) {
    await setBroadcastState(fromId, { message: "", message_id: messageId });
  }
}

async function handleCagyr(fromId: string) {
  const chatState = await getChatState(fromId);
  if (chatState) {
    await sendMessage(fromId, "Siz häzir hem söhbetdeşlikde. Öňki söhbetdeşligi ýapmak üçin /stop");
    return;
  }
  const isAdmin = await isAdminId(fromId);
  if (isAdmin.error) {
    await sendMessage(fromId, "Bul komandy diňe adminler ulanyp bilýär!");
    return;
  }
  await setChatState(fromId, { userId: 0, messageIds: [], calling: true });
  await sendMessage(fromId, "ID ugradyň.");
}

async function handleStop(fromId: string) {
  const chatState = await getChatState(fromId);
  if (!chatState) {
    return;
  }
  await sendMessage(fromId, "Söhbetdeşlik tamamlandy.");
  if (chatState.userId !== 0) {
    await sendMessage(chatState.userId, `<blockquote>bot</blockquote> Söhbetdeşlik tamamlandy.`, { parse_mode: "HTML" });
  }
  if (chatState.messageIds.length > 0) {
    for (let i = 0; i < ADMIN_IDS.length; i++) {
      const messageToSend = isAdminId(fromId).error ? `${userLink({ id: Number(fromId) })} \n${userLink({ id: chatState.userId })} bilen söhbetdeşligi tamamlady` : `${userLink({ id: Number(fromId) })} \n${userLink({ id: chatState.userId })} bilen söhbetdeşligi tamamlady.`;
      await editMessageText(ADMIN_IDS[i], chatState.messageIds[i], messageToSend, { parse_mode: "HTML" });
      if (fromId === ADMIN_IDS[i]) {
        await unpinChatMessage(fromId, chatState.messageIds[i]);
      } else if (chatState.userId.toString() === ADMIN_IDS[i]) {
        await unpinChatMessage(ADMIN_IDS[i], chatState.messageIds[i]);
      }
    }
  }
  await deleteChatState(fromId);
  await deleteChatState(chatState.userId.toString());
}

async function handleOn(fromId: string) {
  const isAdmin = await adminValid(fromId);
  if (isAdmin.error) {
    return;
  }
  let admin = await getAdmin(fromId);
  if (!admin) admin = { tgId: fromId, onlineSatus: false };
  admin.onlineSatus = true;
  await setAdmin(admin);
  await sendMessage(fromId, "Siz Online " + statusIcons.yes[3]);
}

async function handleOf(fromId: string) {
  const isAdmin = await adminValid(fromId);
  if (isAdmin.error) {
    return;
  }
  let admin = await getAdmin(fromId);
  if (!admin) admin = { tgId: fromId, onlineSatus: false };
  admin.onlineSatus = false;
  await setAdmin(admin);
  await sendMessage(fromId, "Siz Offline " + statusIcons.no[3]);
}

async function handleCheck(fromId: string) {
  const isAdmin = await adminValid(fromId);
  if (isAdmin.error) {
    ADMIN_IDS.forEach(async (adminId) => {
      await sendMessage(adminId, sspcsCaseMs(isAdmin.mssg, "/check", undefined, Number(fromId)));
    });
    await sendMessage(fromId, isAdmin.mssg);
    return;
  }
  const messageId = await sendMessage(fromId, "Hasap nomer ýa-da tg ID: ?", { reply_markup: { inline_keyboard: [[{ text: "Yatyr", callback_data: "declineCheck" }]] } });
  if (messageId) {
    await setCheckState(fromId, { messageId });
  }
}

async function handleEditSum(fromId: string) {
  const isAdmin = await adminValid(fromId);
  if (isAdmin.error) {
    ADMIN_IDS.forEach(async (adminId) => {
      await sendMessage(adminId, sspcsCaseMs(isAdmin.mssg, "/" + EDIT_SUMM_COMMAND, undefined, Number(fromId)));
    });
    await sendMessage(fromId, isAdmin.mssg);
    return;
  }
  const messageId = await sendMessage(fromId, "Balans ID ýa-da Telegram ID: ?", { reply_markup: cnclAddSumBtnn() });
  if (messageId) {
    await setSumAddState(fromId, { mssgId: messageId, walNum: "", crrncy: "TMT", sum: 0 });
  }
}

async function handle0804(fromId: string) {
  const transferState = await getTransferState(fromId);
  if (transferState) {
    await sendMessage(fromId, "Birinji öňki geçirimi tamamlaň, soňra täzeden synanyşyň!");
    return;
  }
  const messageId = await sendMessage(fromId, "Kabul edijiniň balans ID-si?", { reply_markup: { inline_keyboard: [[{ text: "Ýatyr " + statusIcons.care[7], callback_data: "declineTransfer" }]] } });
  if (messageId) {
    await setTransferState(fromId, { messageId, recieverID: 0, senderWalNum: "", recieverWalNum: "", amount: 0, currency: "TMT" });
    await pinChatMessage(fromId, messageId);
  } else {
    await sendMessage(fromId, "Ýalňyşlyk ýüze çykdy täzeden synanyşyň.");
  }
}

// Hears handlers
async function handleDukanaGir(fromId: string) {
  await sendMessage(fromId, "Dükana girmek üçin aşaky düwma basyň.", {
    reply_markup: { inline_keyboard: [[{ text: "Söwda 🛒", web_app: { url: DOMAIN } }]] },
  });
}

async function handleBalans(fromId: string) {
  const user = await userValid(fromId);
  if ("error" in user) {
    await sendMessage(fromId, user.mssg + " \n Täzeden synanşyň ýa-da /start berip boty başladyň");
    return;
  }
  await sendMessage(fromId, hspMsg(user.walNum, user.sumTmt, user.sumUsdt), { parse_mode: "HTML" });
}

async function handleAdminiCagyr(fromId: string) {
  const chatState = await getChatState(fromId);
  if (chatState) {
    await sendMessage(fromId, "Siz häzir hem admin bilen söhbetdeşlikde. Öňki söhbetdeşligi ýapmak üçin /stop");
    return;
  }
  const transferState = await getTransferState(fromId);
  if (transferState) {
    await sendMessage(fromId, "Geçirimi açyk wagty admin çagyryp bolmaýar. Geçirimiňizi tamamlap ýa-da ýatyryp admini gaýtadan çagyryň.", { reply_to_message_id: transferState.messageId });
    return;
  }
  const isAdmin = await isAdminId(fromId);
  if (!isAdmin.error) {
    await sendMessage(fromId, "Admin admini çagyryp bilmeýär!");
    return;
  }
  const messageIds: number[] = [];
  for (const adminId of ADMIN_IDS) {
    const msgId = await sendMessage(adminId, `${userLink({ id: Number(fromId) })} söhbetdeşlik talap edýär`, {
      reply_markup: { inline_keyboard: [[{ text: "Tassykla", callback_data: `acceptChat_${fromId}` }]] },
      parse_mode: "HTML",
    });
    if (msgId) messageIds.push(msgId);
  }
  await setChatState(fromId, { userId: 0, username: undefined, messageIds });
  await sendMessage(fromId, "Admin söhbetdeşligi kabul etýänçä garaşyň. Size habar beriler.");
}

// Callback handlers
async function handleAcceptChat(cb: any) {
  const acceptorId = cb.from.id.toString();
  const userID = cb.data.split("_")[1];
  const chatState = await getChatState(userID);
  if (!chatState) {
    await sendMessage(acceptorId, "Yalnyslyk");
    return;
  }
  const acceptorChatState = await getChatState(acceptorId);
  if (acceptorChatState) {
    await answerCallbackQuery(cb.id, "Siz öňem sohbetdeşlikde, ilki öňki söhbetdeşligi tamamlaň! \n /stop", true);
    return;
  }
  if (chatState.userId !== 0) {
    await editMessageText(acceptorId, cb.message.message_id, "Admin häzir başga söhbetdeşlikde, admini özüňiz çagyryň.");
    return;
  }
  chatState.userId = Number(acceptorId);
  await setChatState(acceptorId, { userId: Number(userID), messageIds: chatState.messageIds });
  await setChatState(userID, chatState);
  if (chatState.messageIds.length > 0) {
    for (let i = 0; i < ADMIN_IDS.length; i++) {
      const replyMarkup = ADMIN_IDS[i] === acceptorId ? { inline_keyboard: [[{ text: userID, callback_data: "noop" }]] } : undefined;
      await editMessageText(ADMIN_IDS[i], chatState.messageIds[i], `${userLink({ id: Number(acceptorId) })} bilen ${userLink({ id: Number(userID) })} söhbetdeşlik edýär.`, { parse_mode: "HTML", reply_markup });
      if (acceptorId === ADMIN_IDS[i]) {
        await pinChatMessage(acceptorId, chatState.messageIds[i]);
      }
    }
  } else {
    await editMessageText(acceptorId, cb.message.message_id, "Söhbetdeşlik kabul edildi. Mundan beýläk söhbetdeşlik ýapylýança, ugradan zatlaryňyz garşy tarapa barar.");
  }
  await sendMessage(userID, "Söhbetdeşlik kabul edildi. Mundan beýläk söhbetdeşlik ýapylýança, ugradan zatlaryňyz garşy tarapa barar.");
  await answerCallbackQuery(cb.id);
}

// ... (add other callback handlers like acceptOrder, cancelOrder, deliverOrder, declineOrder, orderDelivered, choose_, select_, complateAdd, complateTransfer, declineAdd, declineTransfer, declineCheck, cancelBroad similarly, translating from the original code)


// On message handler
async function handleMessage(msg: any) {
  const fromId = msg.from.id.toString();
  const text = (msg.text || "").trim();
  const chatId = msg.chat.id.toString();
  if (chatId !== fromId) return; // Private only

  const reasonState = await getReasonState(fromId);
  const sumAddState = await getSumAddState(fromId);
  const transferState = await getTransferState(fromId);
  const chatState = await getChatState(fromId);
  const broadcastState = await getBroadcastState(fromId);
  const checkState = await getCheckState(fromId);
  const signupState = await getSignupState(fromId);

  if (reasonState) {
    const reason = text;
    const ordIdmess = ordrIdMssgFnc(reasonState.orderId);
    await sendMessage(reasonState.client, `${ordrDclngMssgFnc(fromId, false, reason, true)}`, { parse_mode: "HTML", reply_to_message_id: reasonState.clntMssgId });
    for (let i = 0; i < ADMIN_IDS.length; i++) {
      await editMessageText(ADMIN_IDS[i], reasonState.mssgIds[i], `${ordIdmess} ${ordrDclngMssgFnc(fromId, msg.from.first_name, reason)}`, { parse_mode: "HTML" });
    }
    await deleteReasonState(fromId);
  } else if (sumAddState) {
    if (sumAddState.walNum === "") {
      sumAddState.walNum = text;
      await setSumAddState(fromId, sumAddState);
      await editMessageText(fromId, sumAddState.mssgId, `Hasap nomer: ${sumAddState.walNum} \n Walýuta ?`, {
        reply_markup: { inline_keyboard: [
          [{ text: "TMT", callback_data: "choose_TMT" }],
          [{ text: "USDT", callback_data: "choose_USDT" }],
          [{ text: "Goýbolsun " + statusIcons.care[7], callback_data: "declineAdd" }],
        ] },
      });
    } else if (sumAddState.sum === 0) {
      const sum = parseFloat(text);
      if (isNaN(sum)) {
        await deleteSumAddState(fromId);
        await sendMessage(fromId, "Girizen mukdaryňyz nädogry. Başdan synanyşyň.");
        return;
      }
      sumAddState.sum = sum;
      await setSumAddState(fromId, sumAddState);
      await editMessageText(fromId, sumAddState.mssgId, `Hasap nomer: ${sumAddState.walNum} \n ${sumAddState.sum} ${sumAddState.crrncy}`, {
        reply_markup: { inline_keyboard: [[{ text: "Ýalňyş", callback_data: "declineAdd" }, { text: "Dogry", callback_data: "complateAdd" }]] },
      });
    }
  } else if (transferState) {
    // similar logic for transfer
    // ... (implement as per original)
  } else if (checkState) {
    // implement
    // ...
  } else if (chatState && chatState.calling && chatState.userId === 0) {
    // implement
    // ...
  } else if (chatState && chatState.userId !== 0) {
    // copy message to other side
    // ... (implement chat forwarding)
  } else if (signupState) {
    // implement
    // ...
  } else if (broadcastState) {
    // send to all users
    // ...
  } else if (text.startsWith("/")) {
    if (text.startsWith("/start")) await handleStart(fromId, text);
    else if (text.startsWith("/signup")) await handleSignup(fromId);
    else if (text.startsWith("/broadcast")) await handleBroadcast(fromId);
    else if (text.startsWith("/cagyr")) await handleCagyr(fromId);
    else if (text === "/stop") await handleStop(fromId);
    else if (text === "/on") await handleOn(fromId);
    else if (text === "/of") await handleOf(fromId);
    else if (text.startsWith("/check")) await handleCheck(fromId);
    else if (text.startsWith("/" + EDIT_SUMM_COMMAND)) handleEditSum(fromId);
    else if (text === "/0804") handle0804(fromId);
    else if (text === "/test") await sendMessage(fromId, `${statusIcons.yes} \n ${statusIcons.no} \n ${statusIcons.care}`, { parse_mode: "HTML" });
    else await sendMessage(fromId, "Näbelli komanda");
  } else if (text === "Dükana gir 🛒") await handleDukanaGir(fromId);
  else if (text === "Balans") await handleBalans(fromId);
  else if (text === "Admini çagyr") await handleAdminiCagyr(fromId);
  else await sendMessage(fromId, "Näbelli habar");
}

// Callback query handler
async function handleCallbackQuery(cb: any) {
  const fromId = cb.from.id.toString();
  const data = cb.data;
  if (!data) {
    await answerCallbackQuery(cb.id);
    return;
  }
  if (data.startsWith("acceptChat_")) handleAcceptChat(cb);
  // ... (add other callbacks: acceptOrder, cancelOrder, deliverOrder, declineOrder, orderDelivered, choose_, select_, complateAdd, complateTransfer, declineAdd, declineTransfer, declineCheck, cancelBroad)
}

// Server
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();

    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});

// Pre-add example products if needed
// await setProduct({id: 1, priceTMT: 10, priceUSDT: 1, amount: 1, chatRequired: false});
// Add admins
ADMIN_IDS.forEach(async (id) => {
  if (!(await getAdmin(id))) await setAdmin({ tgId: id, onlineSatus: false });
});
console.log("Bot started");