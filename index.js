const fs = require('fs');
const path = require('path');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN || '8588166762:AAGfqluptUIJKw5maz1AUCrN-ACrGSwLgQ4'; // remplacez par le token de votre bot 
const channelUsername = process.env.CHANNEL_USERNAME || '@jephtODG_bot'; // remplacez par le lien de votre canal télégram 
const adminChatId = process.env.ADMIN_CHAT_ID || '62343045716234304571'; // remplacez par votre id telegram 

module.exports.adminChatId = adminChatId;

const bot = new TelegramBot(token, { polling: true });

const usersFile = path.join(__dirname, 'users.json');
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify([], null, 2));

function saveUser(user) {
  const users = JSON.parse(fs.readFileSync(usersFile));
  const exists = users.find(u => u.id === user.id);
  if (!exists) {
    users.push({ ...user, banned: false });
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  }
}

function getUsers() {
  try {
    return JSON.parse(fs.readFileSync(usersFile));
  } catch {
    return [];
  }
}

function updateUser(user) {
  const users = getUsers();
  const index = users.findIndex(u => u.id === user.id);
  if (index !== -1) {
    users[index] = user;
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  }
}

const commands = new Map();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  if (command.name && typeof command.execute === 'function') commands.set(command.name, command);
}

async function checkSubscription(bot, userId) {
  try {
    const member = await bot.getChatMember(channelUsername, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

const userVerificationCache = new Map();

bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';

  const user = {
    id: msg.from.id,
    username: msg.from.username || "Inconnu",
    first_name: msg.from.first_name || "",
    last_name: msg.from.last_name || ""
  };

  saveUser(user);
  const users = getUsers();
  const foundUser = users.find(u => u.id === user.id);

  if (foundUser?.banned) {
    return bot.sendMessage(chatId, "🚫 Tu as été banni. Contacte l'administrateur.");
  }

  if (!text.startsWith('/')) return;

  const args = text.split(' ');
  const commandName = args[0].split('@')[0].substring(1).toLowerCase();

  if (commandName === 'start') {
    const isSub = await checkSubscription(bot, user.id);
    if (!isSub) {
      userVerificationCache.set(user.id, false);
      return bot.sendMessage(chatId, '👋 Bienvenue ! Avant de continuer, rejoins notre canal officiel :', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Rejoindre le canal', url: `https://t.me/${channelUsername.replace('@', '')}` }],
            [{ text: '✅ J\'ai rejoint', callback_data: 'verify_sub' }]
          ]
        }
      });
    }
    userVerificationCache.set(user.id, true);
    return bot.sendMessage(chatId, `✅ Bienvenue ${user.username}!\n\nVous êtes maintenant autorisé à utiliser le bot.\n\nTapez /help pour voir la liste de commandes.`);
  }

  if (userVerificationCache.get(user.id) === false) {
    const isSub = await checkSubscription(bot, user.id);
    if (!isSub) {
      return bot.sendMessage(chatId, '🔒 Pour utiliser le bot, abonne-toi d\'abord au canal ci-dessous :', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Rejoindre le canal', url: `https://t.me/${channelUsername.replace('@', '')}` }],
            [{ text: '✅ J\'ai rejoint', callback_data: 'verify_sub' }]
          ]
        }
      });
    }
    userVerificationCache.set(user.id, true);
    bot.sendMessage(chatId, `✅ Félicitations ${user.username}!\n\nVous êtes maintenant autorisé à utiliser le bot.\n\nTapez /help pour voir la liste de commandes.`);
  }

  const command = commands.get(commandName);
  if (command) command.execute(bot, msg, args.slice(1));
  else bot.sendMessage(chatId, '❓ Commande inconnue.');
});

bot.on('callback_query', async query => {
  const userId = query.from.id.toString();
  const adminId = adminChatId.toString();

  if (query.data === 'verify_sub') {
    const isSub = await checkSubscription(bot, query.from.id);
    if (isSub) {
      userVerificationCache.set(query.from.id, true);
      bot.answerCallbackQuery(query.id, { text: '✅ Abonnement vérifié.' });
      bot.editMessageText(`✅ Félicitations ${query.from.first_name}!\n\nVous êtes maintenant autorisé à utiliser le bot.\n\nTapez /help pour voir la liste de commandes.`, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
    } else {
      bot.answerCallbackQuery(query.id, { text: '❌ Toujours pas abonné.' });
    }
    return;
  }

  if (query.data === 'admin_menu') {
    if (userId !== adminId) return bot.answerCallbackQuery(query.id, { text: '🚫 Accès refusé.' });
    const adminCommands = [
      { text: 'Ban', callback_data: 'run_ban' },
      { text: 'Unban', callback_data: 'run_unban' },
      { text: 'Stats', callback_data: 'run_stats' },
      { text: 'Broadcast', callback_data: 'run_broadcast'},
      { text: 'Send', callback_data: 'run_send'},
      { text: '🔙 Retour', callback_data: 'run_help' }
    ];
    await bot.editMessageText('🛠 Menu Admin', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: adminCommands.map(c => [c]) }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (query.data.startsWith('run_')) {
    const cmdName = query.data.replace('run_', '');
    const cmd = commands.get(cmdName);
    if (!cmd) return bot.answerCallbackQuery(query.id, { text: 'Commande introuvable.' });

    if (['ban', 'unban', 'stats'].includes(cmdName) && userId !== adminId) {
      return bot.answerCallbackQuery(query.id, { text: '🚫 Accès refusé.' });
    }

    const isSub = await checkSubscription(bot, query.from.id);
    if (!isSub) {
      userVerificationCache.set(query.from.id, false);
      return bot.answerCallbackQuery(query.id, { text: '❌ Abonne-toi d\'abord.' });
    }

    const fakeMsg = {
      chat: { id: query.message.chat.id },
      from: query.from,
      text: `/${cmdName}`,
      message_id: query.message.message_id
    };

    await bot.answerCallbackQuery(query.id);
    await cmd.execute(bot, fakeMsg, []);
  }
});

const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot en ligne');
}).listen(port);
