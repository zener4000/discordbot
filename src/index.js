require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const requiredEnvironment = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  console.error(`Faltan variables en .env: ${missingEnvironment.join(', ')}`);
  process.exit(1);
}

const dataDirectory = path.join(__dirname, '..', 'data');
const configFile = path.join(dataDirectory, 'config.json');
const paymentsFile = path.join(dataDirectory, 'payments.json');

fs.mkdirSync(dataDirectory, { recursive: true });

function loadConfigs() {
  if (!fs.existsSync(configFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    console.error('No se pudo leer data/config.json:', error);
    return {};
  }
}

const guildConfigs = loadConfigs();

function loadPayments() {
  if (!fs.existsSync(paymentsFile)) return [];
  try {
    const payments = JSON.parse(fs.readFileSync(paymentsFile, 'utf8'));
    return Array.isArray(payments) ? payments : [];
  } catch (error) {
    console.error('No se pudo leer data/payments.json:', error);
    return [];
  }
}

let payments = loadPayments();

function saveConfigs() {
  fs.writeFileSync(configFile, `${JSON.stringify(guildConfigs, null, 2)}\n`, 'utf8');
}

function savePayments() {
  fs.writeFileSync(paymentsFile, `${JSON.stringify(payments, null, 2)}\n`, 'utf8');
}

function getConfig(guildId) {
  return guildConfigs[guildId] ?? null;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

function openTicketButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:create')
      .setLabel('Crear ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary),
  );
}

function ticketControls(config) {
  if (!config.closeButton) return null;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Cerrar ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );
}

function wlButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('wl:open')
      .setLabel('Abrir formulario WL')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Success),
  );
}

function wlModal() {
  const paid = new TextInputBuilder()
    .setCustomId('paid')
    .setLabel('¿Qué se ha pagado?')
    .setPlaceholder('Describe el producto o servicio pagado')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  return new ModalBuilder()
    .setCustomId('wl:submit')
    .setTitle('Formulario WL')
    .addComponents(new ActionRowBuilder().addComponents(paid));
}

function ticketOwnerId(channel) {
  if (!channel?.topic) return null;
  return channel.topic.match(/ticket-owner:(\d+)/)?.[1] ?? null;
}

function isStaff(member, config) {
  return (
    member.roles.cache.has(config.staffRoleId) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels)
  );
}

function isAdministrator(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

function mentionedUser(message) {
  return message.mentions.users.first() ?? null;
}

function paymentListEmbeds(guild, user, userPayments) {
  const sorted = [...userPayments]
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .slice(0, 100);
  const embeds = [];

  for (let index = 0; index < sorted.length; index += 10) {
    const group = sorted.slice(index, index + 10);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`Pagos recogidos por ${user.username}`)
      .setDescription(
        `Total registrado: **${userPayments.length}**` +
          (userPayments.length > 100 ? '\nSe muestran los 100 más recientes.' : ''),
      )
      .setThumbnail(user.displayAvatarURL());

    group.forEach((payment, offset) => {
      const number = index + offset + 1;
      const timestamp = Math.floor(new Date(payment.submittedAt).getTime() / 1000);
      const deletedNotice = payment.deletedAt ? '\n⚠️ El mensaje de registro fue eliminado.' : '';
      embed.addFields({
        name: `${number}. <t:${timestamp}:f>`,
        value:
          `${payment.paid.slice(0, 450)}\n` +
          `Ticket de <@${payment.ticketOwnerId}>${deletedNotice}`,
      });
    });

    embeds.push(embed);
  }

  return embeds;
}

function canCloseTicket(member, channel, config) {
  return isStaff(member, config) || (config.ownerCanClose && ticketOwnerId(channel) === member.id);
}

function panelMessage(config) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(config.panelTitle)
    .setDescription(config.panelContent)
    .setFooter({ text: 'Solo puedes tener un ticket abierto.' });

  return { embeds: [embed], components: [openTicketButton()] };
}

async function publishPanel(guild, config) {
  const channel = await guild.channels.fetch(config.panelChannelId);
  if (!channel?.isTextBased()) throw new Error('El canal del panel no es un canal de texto.');
  return channel.send(panelMessage(config));
}

const commands = [
  new SlashCommandBuilder()
    .setName('wl')
    .setDescription('Abre el formulario WL dentro de un ticket'),
  new SlashCommandBuilder()
    .setName('configurar')
    .setDescription('Configura y publica el sistema de tickets (solo propietario)')
    .addChannelOption((option) =>
      option
        .setName('canal_panel')
        .setDescription('Canal donde se publicará el panel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('categoria_tickets')
        .setDescription('Categoría donde se crearán los tickets')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('rol_staff')
        .setDescription('Rol que podrá ver y atender los tickets')
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('canal_registros')
        .setDescription('Canal donde se enviarán los formularios WL')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('contenido_panel')
        .setDescription('Texto que verá la gente en el panel')
        .setMaxLength(2000)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('titulo_panel')
        .setDescription('Título del panel (por defecto: Soporte)')
        .setMaxLength(256),
    )
    .addStringOption((option) =>
      option
        .setName('mensaje_ticket')
        .setDescription('Mensaje que aparecerá al abrir cada ticket')
        .setMaxLength(1500),
    )
    .addBooleanOption((option) =>
      option
        .setName('boton_cerrar')
        .setDescription('Mostrar un botón para cerrar los tickets'),
    )
    .addBooleanOption((option) =>
      option
        .setName('usuario_puede_cerrar')
        .setDescription('Permitir que el creador cierre su propio ticket'),
    ),
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands },
  );
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await registerCommands();
    console.log(`Bot conectado como ${readyClient.user.tag}`);
  } catch (error) {
    console.error('No se pudieron registrar los comandos:', error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const command = message.content.trim().toLowerCase();
  const commandName = command.split(/\s+/)[0];

  if (commandName === '?list') {
    if (!isAdministrator(message.member)) {
      await message.reply('Solo los administradores pueden consultar la lista de pagos.');
      return;
    }

    const user = mentionedUser(message);
    if (!user) {
      await message.reply('Debes mencionar a un usuario. Ejemplo: `?list @usuario`.');
      return;
    }

    const userPayments = payments.filter(
      (payment) => payment.guildId === message.guild.id && payment.collectorId === user.id,
    );
    if (userPayments.length === 0) {
      await message.reply(`${user} no tiene pagos recogidos registrados.`);
      return;
    }

    await message.reply({ embeds: paymentListEmbeds(message.guild, user, userPayments) });
    return;
  }

  if (['?borrarlista', '?clearlist', '?resetlist'].includes(commandName)) {
    if (message.author.id !== message.guild.ownerId) {
      await message.reply('Solo el propietario del servidor puede borrar una lista de pagos.');
      return;
    }

    const user = mentionedUser(message);
    if (!user) {
      await message.reply('Debes mencionar a un usuario. Ejemplo: `?borrarlista @usuario`.');
      return;
    }

    const previousLength = payments.length;
    payments = payments.filter(
      (payment) => !(payment.guildId === message.guild.id && payment.collectorId === user.id),
    );
    const deletedCount = previousLength - payments.length;
    savePayments();

    await message.reply(`Se han borrado **${deletedCount}** pagos registrados de ${user}.`);
    return;
  }

  if (command === '?panel') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply('Solo un administrador puede publicar el panel.');
      return;
    }

    const config = getConfig(message.guild.id);
    if (!config) {
      await message.reply('Primero debes ejecutar `/configurar`.');
      return;
    }

    await publishPanel(message.guild, config);
    await message.reply(`Panel publicado en <#${config.panelChannelId}>.`);
    return;
  }

  if (command === '?wl') {
    const config = getConfig(message.guild.id);
    if (!config) {
      await message.reply('El sistema de tickets todavía no está configurado.');
      return;
    }
    if (!ticketOwnerId(message.channel)) {
      await message.reply('Este comando solo se puede usar dentro de un ticket.');
      return;
    }
    if (!message.member.roles.cache.has(config.staffRoleId)) {
      await message.reply('Solo el rol encargado de los tickets puede usar `?wl`.');
      return;
    }

    await message.reply({
      content: 'Pulsa el botón para abrir el formulario:',
      components: [wlButton()],
    });
  }
});

async function handleDeletedPayment(messageId) {
  const payment = payments.find(
    (entry) => entry.logMessageId === messageId && !entry.deletedAt,
  );
  if (!payment) return;

  payment.deletedAt = new Date().toISOString();
  savePayments();

  try {
    const guild = await client.guilds.fetch(payment.guildId);
    const owner = await guild.fetchOwner();
    const deletedAt = Math.floor(new Date(payment.deletedAt).getTime() / 1000);
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Se ha eliminado un registro de pago')
      .setDescription('Un mensaje de pago enviado por el bot ha sido eliminado.')
      .addFields(
        { name: 'Pago', value: payment.paid.slice(0, 1000) },
        { name: 'Recogido por', value: `<@${payment.collectorId}>`, inline: true },
        { name: 'Ticket de', value: `<@${payment.ticketOwnerId}>`, inline: true },
        { name: 'Canal de registros', value: `<#${payment.logChannelId}>`, inline: true },
        { name: 'ID del mensaje', value: payment.logMessageId, inline: true },
        { name: 'Eliminado', value: `<t:${deletedAt}:f>`, inline: true },
      );

    try {
      await owner.send({ embeds: [embed] });
    } catch (directMessageError) {
      const config = getConfig(guild.id);
      let fallbackChannel = guild.systemChannel;
      if (!fallbackChannel && config?.panelChannelId) {
        fallbackChannel = await guild.channels.fetch(config.panelChannelId).catch(() => null);
      }

      if (fallbackChannel?.isTextBased()) {
        await fallbackChannel.send({
          content: `<@${owner.id}>, no he podido enviarte este aviso por mensaje privado.`,
          embeds: [embed],
          allowedMentions: { users: [owner.id] },
        });
      } else {
        console.error('No se pudo avisar al propietario sobre el registro eliminado:', directMessageError);
      }
    }
  } catch (error) {
    console.error('Error al procesar la eliminación de un registro de pago:', error);
  }
}

client.on(Events.MessageDelete, async (message) => {
  await handleDeletedPayment(message.id);
});

client.on(Events.MessageBulkDelete, async (messages) => {
  for (const messageId of messages.keys()) {
    await handleDeletedPayment(messageId);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand() && interaction.commandName === 'configurar') {
      if (interaction.user.id !== interaction.guild.ownerId) {
        await interaction.reply({
          content: 'Solo el propietario del servidor puede configurar los tickets.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const config = {
        panelChannelId: interaction.options.getChannel('canal_panel', true).id,
        ticketCategoryId: interaction.options.getChannel('categoria_tickets', true).id,
        staffRoleId: interaction.options.getRole('rol_staff', true).id,
        logChannelId: interaction.options.getChannel('canal_registros', true).id,
        panelContent: interaction.options.getString('contenido_panel', true),
        panelTitle: interaction.options.getString('titulo_panel') ?? 'Soporte',
        ticketMessage:
          interaction.options.getString('mensaje_ticket') ??
          'Explica aquí lo que necesitas. El equipo puede registrar una WL usando `?wl` o `/wl`.',
        closeButton: interaction.options.getBoolean('boton_cerrar') ?? true,
        ownerCanClose: interaction.options.getBoolean('usuario_puede_cerrar') ?? true,
      };

      guildConfigs[interaction.guild.id] = config;
      saveConfigs();

      try {
        const panel = await publishPanel(interaction.guild, config);
        await interaction.editReply(
          `Configuración guardada y panel publicado en <#${config.panelChannelId}>: ${panel.url}`,
        );
      } catch (error) {
        await interaction.editReply(
          'La configuración se guardó, pero no pude publicar el panel. Comprueba mis permisos en ese canal.',
        );
        console.error(error);
      }
      return;
    }

    const config = getConfig(interaction.guild.id);
    if (!config) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'Un administrador debe ejecutar `/configurar` primero.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'wl') {
      if (!ticketOwnerId(interaction.channel)) {
        await interaction.reply({ content: 'Este comando solo funciona dentro de un ticket.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (!interaction.member.roles.cache.has(config.staffRoleId)) {
        await interaction.reply({ content: 'Solo el rol encargado de los tickets puede usar WL.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(wlModal());
      return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket:create') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const existing = interaction.guild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildText && ticketOwnerId(channel) === interaction.user.id,
      );
      if (existing) {
        await interaction.editReply(`Ya tienes un ticket abierto: ${existing}`);
        return;
      }

      const safeName = interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 70);

      const channel = await interaction.guild.channels.create({
        name: `ticket-${safeName || interaction.user.id}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId,
        topic: `ticket-owner:${interaction.user.id}`,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            id: config.staffRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages,
            ],
          },
        ],
      });

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('Ticket abierto')
        .setDescription(`Hola ${interaction.user}, ${config.ticketMessage}`);

      const controls = ticketControls(config);

      await channel.send({
        content: `${interaction.user} <@&${config.staffRoleId}>`,
        embeds: [embed],
        components: controls ? [controls] : [],
        allowedMentions: { users: [interaction.user.id], roles: [config.staffRoleId] },
      });
      await interaction.editReply(`Tu ticket se ha creado: ${channel}`);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'wl:open') {
      if (!ticketOwnerId(interaction.channel) || !interaction.member.roles.cache.has(config.staffRoleId)) {
        await interaction.reply({ content: 'Solo el rol encargado de los tickets puede abrir este formulario.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(wlModal());
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'wl:submit') {
      if (!ticketOwnerId(interaction.channel) || !interaction.member.roles.cache.has(config.staffRoleId)) {
        await interaction.reply({ content: 'Solo el rol encargado de los tickets puede enviar este formulario.', flags: MessageFlags.Ephemeral });
        return;
      }

      const logChannel = await interaction.guild.channels.fetch(config.logChannelId);
      if (!logChannel?.isTextBased()) {
        await interaction.reply({ content: 'El canal de registros no está disponible.', flags: MessageFlags.Ephemeral });
        return;
      }

      const paid = interaction.fields.getTextInputValue('paid');
      const ownerId = ticketOwnerId(interaction.channel);

      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle('Nuevo formulario WL')
        .addFields(
          { name: 'Qué se ha pagado', value: paid },
          { name: 'Recogido por', value: `${interaction.user}`, inline: true },
          { name: 'Ticket de', value: `<@${ownerId}>`, inline: true },
          { name: 'Canal de origen', value: `${interaction.channel}`, inline: true },
        )
        .setTimestamp();

      const logMessage = await logChannel.send({ embeds: [embed] });

      payments.push({
        id: `${interaction.guild.id}:${logMessage.id}`,
        guildId: interaction.guild.id,
        collectorId: interaction.user.id,
        paid,
        ticketOwnerId: ownerId,
        ticketChannelId: interaction.channel.id,
        logChannelId: logChannel.id,
        logMessageId: logMessage.id,
        submittedAt: new Date().toISOString(),
        deletedAt: null,
      });
      savePayments();

      await interaction.channel.setName('pendiente-de-whitelist', 'Formulario WL enviado');
      await interaction.channel.permissionOverwrites.edit(interaction.guild.id, {
        SendMessages: false,
      });
      await interaction.channel.permissionOverwrites.edit(ownerId, {
        SendMessages: false,
      });
      await interaction.channel.permissionOverwrites.edit(config.staffRoleId, {
        SendMessages: false,
      });

      await interaction.reply({
        content: 'Formulario enviado. El ticket está pendiente de whitelist y ha quedado bloqueado.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket:close') {
      if (!canCloseTicket(interaction.member, interaction.channel, config)) {
        await interaction.reply({ content: 'No tienes permiso para cerrar este ticket.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply('El ticket se cerrará en 5 segundos.');
      setTimeout(async () => {
        await interaction.channel.delete('Ticket cerrado').catch(console.error);
      }, 5000);
    }
  } catch (error) {
    console.error('Error procesando una interacción:', error);
    const response = {
      content: 'Ha ocurrido un error. Revisa la configuración y los permisos del bot.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else if (interaction.isRepliable()) {
      await interaction.reply(response).catch(() => {});
    }
  }
});

if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN);
}

module.exports = { commands, panelMessage, ticketOwnerId };
