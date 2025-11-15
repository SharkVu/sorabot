require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const { PlayerManager, Player, Track } = require("ziplayer");
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} = require("discord.js");
const { SoundCloudPlugin, YouTubePlugin, SpotifyPlugin } = require("@ziplayer/plugin");
const { exec } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs").promises;

const prefix = "0";
const execPromise = promisify(exec);

const downloadUrlMap = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
    ],
});

const playerManager = new PlayerManager({
    plugins: [new SoundCloudPlugin(), new YouTubePlugin(), new SpotifyPlugin()],
});

const logDebug = (message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message} | Data: ${JSON.stringify(data, null, 2)}`);
};

const createEmbed = (title, description, color = 0x2f3136) =>
    new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: "🎶 Sora Bot - Music Bot" });

const updateVoiceChannelStatus = async (player, track) => {
    try {
        const voiceChannelId = player?.connection?.joinConfig?.channelId;
        if (!voiceChannelId) {
            logDebug("Không thể cập nhật trạng thái kênh voice: Thiếu channelId", {
                guildId: player?.guildId,
                track: track?.title
            });
            return;
        }

        // Lấy guild từ client.guilds.cache sử dụng guildId
        const guild = client.guilds.cache.get(player.guildId);
        if (!guild) {
            logDebug("Không thể cập nhật trạng thái kênh voice: Không tìm thấy guild", {
                guildId: player?.guildId
            });
            return;
        }

        // Lấy kênh voice từ guild.channels.cache
        const voiceChannel = guild.channels.cache.get(voiceChannelId);
        if (!voiceChannel || voiceChannel.type !== 2) {
            logDebug("Không thể cập nhật trạng thái kênh voice: Kênh không hợp lệ", {
                channelId: voiceChannelId,
                channelType: voiceChannel?.type
            });
            return;
        }

        const permissions = voiceChannel.permissionsFor(guild.members.me);
        if (!permissions.has("MANAGE_CHANNELS")) {
            logDebug("Không có quyền cập nhật trạng thái kênh voice", {
                channelId: voiceChannel.id,
                permissions: permissions.toArray()
            });
            return;
        }

        const trackTitle = track?.title || "Không xác định";
        const statusText = `🎵 ${trackTitle}`;
        const maxLength = 500;
        const finalStatus = statusText.length > maxLength 
            ? statusText.substring(0, maxLength - 3) + "..." 
            : statusText;

        logDebug("Chuẩn bị cập nhật trạng thái kênh voice", {
            channelId: voiceChannel.id,
            guildId: guild.id,
            status: finalStatus
        });

        try {
            await client.rest.put(`/channels/${voiceChannel.id}/voice-status`, {
                body: { status: finalStatus }
            });
            logDebug("Cập nhật trạng thái kênh voice thành công (PUT)", {
                channelId: voiceChannel.id,
                status: finalStatus
            });
        } catch (error) {
            logDebug("Lỗi khi cập nhật trạng thái kênh voice (PUT)", {
                channelId: voiceChannel.id,
                error: error.message
            });

            try {
                await client.rest.patch(`/channels/${voiceChannel.id}`, {
                    body: { status: finalStatus }
                });
                logDebug("Cập nhật trạng thái kênh voice thành công (PATCH)", {
                    channelId: voiceChannel.id,
                    status: finalStatus
                });
            } catch (patchError) {
                logDebug("Lỗi khi cập nhật trạng thái kênh voice (PATCH)", {
                    channelId: voiceChannel.id,
                    error: patchError.message
                });
            }
        }
    } catch (error) {
        logDebug("Lỗi tổng quát khi cập nhật trạng thái kênh voice", {
            guildId: player?.guildId,
            channelId: player?.connection?.joinConfig?.channelId,
            error: error.message
        });
    }
};

const clearVoiceChannelStatus = async (player) => {
    try {
        if (!player?.connection?.joinConfig?.channelId) {
            logDebug("Không thể xóa trạng thái kênh voice: Thiếu channelId", {
                guildId: player?.guildId
            });
            return;
        }

        const guild = player.connection.guild;
        if (!guild) {
            logDebug("Không thể xóa trạng thái kênh voice: Không tìm thấy guild", {
                guildId: player?.guildId
            });
            return;
        }

        const voiceChannel = guild.channels.cache.get(player.connection.joinConfig.channelId);
        if (!voiceChannel || voiceChannel.type !== 2) {
            logDebug("Không thể xóa trạng thái kênh voice: Kênh không hợp lệ", {
                channelId: player.connection.joinConfig.channelId,
                channelType: voiceChannel?.type
            });
            return;
        }

        const permissions = voiceChannel.permissionsFor(guild.members.me);
        if (!permissions.has("MANAGE_CHANNELS")) {
            logDebug("Không có quyền xóa trạng thái kênh voice", {
                channelId: voiceChannel.id,
                permissions: permissions.toArray()
            });
            return;
        }

        logDebug("Chuẩn bị xóa trạng thái kênh voice", {
            channelId: voiceChannel.id,
            guildId: guild.id
        });

        try {
            await guild.client.rest.put(`/channels/${voiceChannel.id}/voice-status`, {
                body: { status: null }
            });
            logDebug("Xóa trạng thái kênh voice thành công (PUT)", {
                channelId: voiceChannel.id
            });
        } catch (error) {
            logDebug("Lỗi khi xóa trạng thái kênh voice (PUT)", {
                channelId: voiceChannel.id,
                error: error.message
            });

            try {
                await guild.client.rest.patch(`/channels/${voiceChannel.id}`, {
                    body: { status: "" }
                });
                logDebug("Xóa trạng thái kênh voice thành công (PATCH)", {
                    channelId: voiceChannel.id
                });
            } catch (patchError) {
                logDebug("Lỗi khi xóa trạng thái kênh voice (PATCH)", {
                    channelId: voiceChannel.id,
                    error: patchError.message
                });
            }
        }
    } catch (error) {
        logDebug("Lỗi tổng quát khi xóa trạng thái kênh voice", {
            guildId: player?.guildId,
            channelId: player?.connection?.joinConfig?.channelId,
            error: error.message
        });
    }
};

const createProgressBar = (currentTime, totalDuration) => {
    if (!totalDuration || totalDuration <= 0) return "00:00";
    const totalBlocks = 10;
    const secondsPerBlock = totalDuration / totalBlocks;
    const filledBlocks = Math.min(totalBlocks, Math.floor(currentTime / secondsPerBlock));
    const emptyBlocks = totalBlocks - filledBlocks;
    const progressBar = "█".repeat(filledBlocks) + "<a:ga_vn:1383145143711830238>" + "…".repeat(emptyBlocks);
    return `${formatDuration(currentTime)} ${progressBar} ${formatDuration(totalDuration)}`;
};

const generateDownloadId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const nowPlayingEmbed = (player, track, requesterId) => {
    if (!track || !player) {
        return new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("❌ LỖI")
            .setDescription("Không có thông tin bài hát hoặc trình phát.")
            .setTimestamp()
            .setFooter({ text: "🎶 Sora Bot - MUSIC - Music Bot" });
    }

    // Tách tiêu đề bài hát và tên tác giả từ track.title
    const trackTitle = track?.title || "Không xác định";
    const parts = trackTitle.split(" - ");
    const songName = parts[0]?.trim() || "Không xác định";
    const author = parts[1]?.trim() || "Không xác định"; // Lấy phần sau dấu "-" làm tên tác giả
    const requester = requesterId ? `<@${requesterId}>` : "Ẩn danh";

    const currentTime = player.userdata?.currentTime || 0;
    let totalDuration = track?.duration || 0;
    
    if (totalDuration > 86400) {
        totalDuration = Math.floor(totalDuration / 1000);
    }
    
    if (player?.queue?.current?.duration && player.queue.current.duration > 0) {
        let playerDuration = player.queue.current.duration;
        if (playerDuration > 86400) {
            playerDuration = Math.floor(playerDuration / 1000);
        }
        totalDuration = playerDuration;
    } else if (player?.currentTrack?.duration && player.currentTrack.duration > 0) {
        let currentTrackDuration = player.currentTrack.duration;
        if (currentTrackDuration > 86400) {
            currentTrackDuration = Math.floor(currentTrackDuration / 1000);
        }
        totalDuration = currentTrackDuration;
    }

    let queueCount = 0;
    if (player.queue?.tracks && Array.isArray(player.queue.tracks)) {
        queueCount = player.queue.tracks.length;
    } else if (player.queue && typeof player.queue.size === "number") {
        queueCount = player.queue.size;
    }
    
    const queueText = queueCount > 0 ? `📋 **${queueCount}** bài trong hàng đợi` : "📋 Hàng đợi trống";

    return new EmbedBuilder()
        .setColor(0xefe9dc)
        .setTitle("<a:youtube:1243683781320380426> ĐANG PHÁT <a:maume:1384962760693125140>")
        .setThumbnail("attachment://logo.gif")
        .addFields(
            { name: "🎧 Tên bài hát", value: songName, inline: true }, // Sử dụng songName thay vì track.title
            { name: "👤 Tác giả", value: author, inline: true }, // Sử dụng author từ phần sau dấu "-"
            { name: "⏱ Thời lượng", value: totalDuration && totalDuration > 0 ? formatDuration(totalDuration) : "00:00", inline: true },
            { name: "⏳ Tiến trình", value: totalDuration && totalDuration > 0 ? createProgressBar(currentTime, totalDuration) : "00:00", inline: false },
            { name: "<:PandaOhNo:1426614396364525680> Người yêu cầu", value: requester, inline: true },
            { name: "📊 Hàng đợi", value: queueText, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "🎶 Sora Bot - MUSIC - Music Bot" });
};

const getSuggestedTracks = async (currentTrack) => {
    if (!currentTrack?.title) return [];
    
    try {
        const keywords = currentTrack.title
            .replace(/[\[\]()]/g, ' ')
            .replace(/official|video|music|mv|audio|lyrics|hd|4k/gi, ' ')
            .split(' ')
            .filter(word => word.length > 2)
            .slice(0, 3)
            .join(' ');

        const results = await playerManager.search(`${keywords} music`);
        return results?.tracks?.filter(track => track?.url !== currentTrack.url).slice(0, 5) || [];
    } catch (error) {
        logDebug("Không thể lấy gợi ý bài hát", { error: error.message });
        return [];
    }
};

const createSuggestionMenu = async (currentTrack, customId = "suggestion_select") => {
    const options = [
        new StringSelectMenuOptionBuilder()
            .setLabel("🎲 Phát ngẫu nhiên")
            .setDescription("Để bot tự động chọn bài tiếp theo")
            .setValue("random_next")
            .setEmoji("🎲")
    ];

    const suggestions = await getSuggestedTracks(currentTrack);
    suggestions.forEach((track, index) => {
        if (!track?.title) return;
        const title = track.title.length > 100 ? track.title.substring(0, 97) + "..." : track.title;
        const author = track.author || "Không xác định";
        const description = author.length > 50 ? author.substring(0, 47) + "..." : author;
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(title)
                .setDescription(`♪ ${description}`)
                .setValue(`suggestion_${index}`)
                .setEmoji("🎵")
        );
    });

    if (options.length === 1) {
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel("🎵 Không tìm thấy gợi ý")
                .setDescription("Hãy thử tự thêm bài hoặc dùng chế độ ngẫu nhiên")
                .setValue("no_suggestions")
                .setEmoji("❌")
        );
    }

    return new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder("🎵 Chọn bài hát tiếp theo hoặc để bot tự chọn...")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);
};

const extractYouTubeChannel = (url) => {
    if (!url) return "Không xác định";
    try {
        const match = url.match(/[&?]channel=([^&]+)/) || url.match(/channel\/([^/?]+)/) || url.match(/user\/([^/?]+)/);
        return match ? match[1] : "Không xác định";
    } catch {
        return "Không xác định";
    }
};

const formatDuration = (durationInSeconds) => {
    if (!durationInSeconds || isNaN(durationInSeconds) || durationInSeconds <= 0) {
        return "00:00";
    }
    
    let duration = durationInSeconds;
    if (duration > 86400) {
        duration = Math.floor(duration / 1000);
    }
    
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.floor(duration % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    } else {
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }
};

const createLeaveEmbed = () => {
    return new EmbedBuilder()
        .setColor(0x2f3136)
        .setTitle("🎶 Sora Bot - MUSIC - Music Bot")
        .setDescription("CHÚC BẠN VÀ GIA ĐÌNH CÓ MỘT NGÀY TỐT LÀNH!")
        .setTimestamp()
        .setFooter({ text: "🎶 Sora Bot - MUSIC - Music Bot" });
};

const createTagEmbed = (user) => {
    if (!user?.id) return createEmbed("❌ LỖI", "Không xác định người dùng.", 0xff0000);
    const description = `👋 Hey <@${user.id}>, It's me **Sora Bot - Music Bot** >.<  
🎶 Discover music with me by using Slash command \`/play | 0play\`  
⚡ My prefix for this server is \`0\`  | Slash command: \`/play\`
💡 Need help or support from my developers?  
👉 Contact **ADMIN Shark Vũ** for bot support!  

——— 🇻🇳 ———  

👋 Xin chào <@${user.id}>, tôi là **Sora Bot - Music Bot** >.<  
🎶 Khám phá âm nhạc cùng tôi bằng cách sử dụng Slash command \`/play | 0play\`  
⚡ Tiền tố của tôi cho máy chủ này là \`0\`  | Slash command: \`/play\`
💡 Bạn cần trợ giúp hoặc hỗ trợ từ nhà phát triển?  
👉 Hãy liên hệ với **ADMIN Shark Vũ** để được hỗ trợ bot!  

Trân trọng. 🙏`;

    return new EmbedBuilder()
        .setColor(0xefe9dc)
        .setDescription(description)
        .setImage("attachment://banner.png")
        .setTimestamp()
        .setFooter({ text: "🎶 Sora Bot - MUSIC - Music Bot" });
};

const createHelpEmbed = (user) => {
    if (!user?.id) return createEmbed("❌ LỖI", "Không xác định người dùng.", 0xff0000);
    const description = `👋 Xin chào <@${user.id}>, đây là hướng dẫn sử dụng **Sora Bot - Music Bot**!  

**📜 Lệnh khả dụng (Prefix: \`0\` hoặc Slash Command: \`/command\`)**  
• **play | 0play <URL/từ khóa>**  
   Phát bài hát từ YouTube, Spotify, SoundCloud.  
   Ví dụ: \`/play https://youtube.com/watch?v=...\` hoặc \`0play Happy\`  
• **dow | 0dow <URL YouTube>**  
   Tải video YouTube dưới dạng MP3, MP4, hoặc AVI.  
   Ví dụ: \`/dow link:https://youtube.com/watch?v=...\` hoặc \`0dow https://youtube.com/watch?v=...\`  
• **queue | 0queue | 0q**  
   Xem danh sách bài hát trong hàng đợi.  
   Ví dụ: \`/queue\` hoặc \`0q\`  
• **leave | 0leave**  
   Ngắt kết nối bot khỏi kênh thoại và xóa hàng đợi.  
   Ví dụ: \`/leave\` hoặc \`0leave\`  
• **help | 0help**  
   Hiển thị hướng dẫn này.  
   Ví dụ: \`/help\` hoặc \`0help\`  

**🎮 Các nút điều khiển (trong giao diện phát nhạc)**  
• ➕ **Thêm bài**: Mở form để thêm bài hát tiếp theo.  
• ⏮ **Bài trước**: Phát lại bài trước đó (nếu có).  
• ⏸/▶ **Tạm dừng/Tiếp tục**: Tạm dừng hoặc tiếp tục bài hát.  
• ⏭ **Bỏ qua**: Chuyển sang bài tiếp theo hoặc dừng nếu không còn bài.  
• 🔁 **Lặp lại**: Chuyển đổi giữa tắt lặp, lặp bài hiện tại, lặp hàng đợi.  
• 🎲 **Auto-play**: Bật/tắt chế độ tự động chọn bài tương tự.  
• 🔉 **Giảm âm lượng**: Giảm âm lượng xuống 10%.  
• 🔊 **Tăng âm lượng**: Tăng âm lượng lên 10%.  
• 📋 **Hàng đợi**: Xem danh sách bài hát hiện tại.  
• 🎵 **Menu gợi ý**: Chọn bài hát tương tự hoặc bật phát ngẫu nhiên.  

**💡 Mẹo**  
- Tham gia kênh thoại trước khi dùng lệnh \`play\`.  
- Dùng menu gợi ý để khám phá nhạc mới!  
- Gặp vấn đề? Nhấn nút **🛎 Báo Lỗi** hoặc liên hệ **ADMIN Shark Vũ**.  

——— 🇻🇳 ———  
Trân trọng, **Sora Bot - Music Bot** 🎶`;

    return new EmbedBuilder()
        .setColor(0xefe9dc)
        .setTitle("🎶 HƯỚNG DẪN SỬ DỤNG - Sora Bot - MUSIC BOT")
        .setDescription(description)
        .setImage("attachment://banner.png")
        .setTimestamp()
        .setFooter({ text: "🎶 Sora Bot - MUSIC - Music Bot" });
};

const safePause = async (player) => {
    if (!player) return false;
    try {
        if (typeof player.pause === "function") return await player.pause();
        if (player.setPaused) return await player.setPaused(true);
        return false;
    } catch (error) {
        logDebug("Lỗi khi tạm dừng", { error: error.message });
        return false;
    }
};

const safeResume = async (player) => {
    if (!player) return false;
    try {
        if (typeof player.resume === "function") return await player.resume();
        if (typeof player.unpause === "function") return await player.unpause();
        if (player.node?.setPaused) return await player.node.setPaused(false);
        if (player.setPaused) return await player.setPaused(false);
        return false;
    } catch (error) {
        logDebug("Lỗi khi tiếp tục phát", { error: error.message });
        return false;
    }
};

const addNext = async (player, url, requestedBy) => {
    if (!player || !url) return false;
    try {
        const res = await playerManager.search(url, requestedBy).catch((e) => {
            logDebug("Tìm kiếm thất bại", { url, error: e.message });
            return null;
        });
        
        const track = res?.tracks?.[0];
        if (!track) return false;

        const playResult = await player.play(url).catch((e) => {
            logDebug("Lỗi khi phát", { url, error: e.message });
            return null;
        });
        return playResult ? track : false;
    } catch (e) {
        logDebug("Lỗi khi thêm bài hát tiếp theo", { url, error: e.message });
        return false;
    }
};

const autoAddSimilarTrack = async (player, currentTrack) => {
    if (!player?.userdata?.autoPlay || !currentTrack) return false;
    
    try {
        const suggestions = await getSuggestedTracks(currentTrack);
        if (suggestions.length === 0) return false;
        
        const randomTrack = suggestions[Math.floor(Math.random() * suggestions.length)];
        const success = await addNext(player, randomTrack.url, { id: 'autoplay', username: 'Auto Play' });
        
        if (success) {
            const embed = createEmbed(
                "🎲 TỰ ĐỘNG THÊM", 
                `**${randomTrack.title || "Không xác định"}**\n*Tác giả: ${randomTrack.author || "Không xác định"}*`,
                0x00ff00
            );
            
            player.userdata.channel?.send({ embeds: [embed] }).then((msg) => {
                setTimeout(() => {
                    msg.delete().catch(() => {});
                }, 5000);
            });
            
            return true;
        }
        return false;
    } catch (error) {
        logDebug("Lỗi khi tự động thêm bài tương tự", { error: error.message });
        return false;
    }
};

const repeatLabel = (mode) => {
    if (mode === 1) return "🔂 Lặp lại bài hiện tại.";
    if (mode === 2) return "🔁 Lặp lại toàn bộ hàng đợi.";
    return "🔁 Loop đã tắt.";
};

const reportErrorButton = () =>
    new ButtonBuilder()
        .setLabel("🛎 Báo Lỗi")
        .setStyle(ButtonStyle.Link)
        .setURL("https://discord.com/users/852613496000872489");

const buildLeaveControls = () => {
    return [new ActionRowBuilder().addComponents(reportErrorButton())];
};

const buildControls = (paused, repeatMode = 0, hasAutoPlay = true) => {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("add_next").setEmoji("➕").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("previous").setEmoji("<:prev:1261482963594383502>").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(paused ? "resume" : "pause")
            .setEmoji(paused ? "<:play:1261482961199698051>" : "<:pause:1261482959006072862>")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("skip").setEmoji("<:next:1261482957135417455>").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("loop").setEmoji("<:loop1:1261482947324678195>").setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("toggle_autoplay")
            .setEmoji(hasAutoPlay ? "<:shuffle:1261483380890013738>" : "⏹")
            .setLabel(hasAutoPlay ? " " : "Manual")
            .setStyle(hasAutoPlay ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("decrease_volume").setEmoji("<:voldec:1261482974327869460>").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("stop").setEmoji("<:stop:1261482972545159189>").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("increase_volume").setEmoji("<:volinc:1261483382731440190>").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("queue").setEmoji("<:lyrics:1261482953297629246>").setLabel(" ").setStyle(ButtonStyle.Primary),
    );

    return [row1, row2];
};

const disableMessageButtons = async (msg) => {
    if (!msg) return;
    try {
        const disabledRows = (msg.components || []).map((row) => {
            const r = new ActionRowBuilder();
            r.addComponents(...row.components.map((b) => ButtonBuilder.from(b).setDisabled(true)));
            return r;
        });
        await msg.edit({ components: disabledRows });
    } catch (error) {
        logDebug("Không thể vô hiệu hóa nút", { error: error.message });
    }
};

const updateLeaveMessage = async (channel, message) => {
    if (!channel || !message) return;
    try {
        await message.edit({
            embeds: [createLeaveEmbed()],
            components: buildLeaveControls(),
        });
    } catch (e) {
        logDebug("Lỗi khi cập nhật tin nhắn rời kênh", { error: e.message });
        try {
            await channel.send({
                embeds: [createLeaveEmbed()],
                components: buildLeaveControls(),
            });
        } catch (e2) {
            logDebug("Không thể gửi tin nhắn mới", { error: e2.message });
        }
    }
};

const ensureControllerMessage = async (player, track, requesterId) => {
    if (!player?.userdata?.channel || !track) return;
    
    const embed = nowPlayingEmbed(player, track, requesterId);
    const hasAutoPlay = player.userdata.autoPlay !== false;
    
    const components = [
        ...buildControls(!!player.userdata.paused, player.userdata.repeatMode ?? 0, hasAutoPlay)
    ];
    
    try {
        const suggestionMenu = await createSuggestionMenu(track, "suggestion_select");
        components.push(new ActionRowBuilder().addComponents(suggestionMenu));
        player.userdata.currentSuggestions = await getSuggestedTracks(track);
    } catch (error) {
        logDebug("Lỗi khi tạo menu gợi ý", { error: error.message });
        const basicMenu = new StringSelectMenuBuilder()
            .setCustomId("suggestion_select")
            .setPlaceholder("🎲 Không tìm thấy gợi ý, chỉ có tự động phát...")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions([
                new StringSelectMenuOptionBuilder()
                    .setLabel("🎲 Phát ngẫu nhiên")
                    .setDescription("Để bot tự động chọn bài tiếp theo")
                    .setValue("random_next")
                    .setEmoji("🎲")
            ]);
        components.push(new ActionRowBuilder().addComponents(basicMenu));
    }
    
    const attachment = new AttachmentBuilder("assets/logo.gif");
    if (!player.userdata.controlsMessage?.id) {
        const sent = await player.userdata.channel.send({
            embeds: [embed],
            components: components,
            files: [attachment],
        });
        player.userdata.controlsMessage = sent;
    } else {
        try {
            await player.userdata.controlsMessage.edit({
                embeds: [embed],
                components: components,
            });
        } catch (editError) {
            logDebug("Không thể chỉnh sửa tin nhắn điều khiển", { error: editError.message });
            const sent = await player.userdata.channel.send({
                embeds: [embed],
                components: components,
                files: [attachment],
            });
            player.userdata.controlsMessage = sent;
        }
    }
};

const updateControls = async (player) => {
    if (!player?.userdata?.controlsMessage) return;
    try {
        const msg = player.userdata.controlsMessage;
        
        const hasAutoPlay = player.userdata.autoPlay !== false;
        const components = buildControls(!!player.userdata.paused, player.userdata.repeatMode ?? 0, hasAutoPlay);
        
        try {
            const currentTrack = player.currentTrack || player.track;
            if (!currentTrack) return;
            
            const suggestionMenu = await createSuggestionMenu(currentTrack, "suggestion_select");
            components.push(new ActionRowBuilder().addComponents(suggestionMenu));
            player.userdata.currentSuggestions = await getSuggestedTracks(currentTrack);
        } catch (menuError) {
            logDebug("Lỗi khi thêm menu gợi ý vào điều khiển", { error: menuError.message });
            const fallbackMenu = new StringSelectMenuBuilder()
                .setCustomId("suggestion_select")
                .setPlaceholder("🎵 Menu gợi ý (có lỗi khi tải)")
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel("🎲 Phát ngẫu nhiên")
                        .setDescription("Để bot tự động chọn bài tiếp theo")
                        .setValue("random_next")
                        .setEmoji("🎲")
                ]);
            components.push(new ActionRowBuilder().addComponents(fallbackMenu));
        }
        
        await msg.edit({ components: components });
    } catch (e) {
        logDebug("Không thể cập nhật nút điều khiển", { error: e.message });
    }
};

const startProgressBar = (player, track) => {
    if (!player || !track) return;
    if (player.userdata.progressInterval) {
        clearInterval(player.userdata.progressInterval);
    }

    player.userdata.currentTime = 0;
    
    let trackDuration = track?.duration || 0;
    if (trackDuration > 86400) {
        trackDuration = Math.floor(trackDuration / 1000);
    }
    
    if (player?.queue?.current?.duration && player.queue.current.duration > 0) {
        let playerDuration = player.queue.current.duration;
        if (playerDuration > 86400) {
            playerDuration = Math.floor(playerDuration / 1000);
        }
        trackDuration = playerDuration;
    } else if (player?.currentTrack?.duration && player.currentTrack.duration > 0) {
        let currentTrackDuration = player.currentTrack.duration;
        if (currentTrackDuration > 86400) {
            currentTrackDuration = Math.floor(currentTrackDuration / 1000);
        }
        trackDuration = currentTrackDuration;
    }
    
    player.userdata.correctedDuration = trackDuration;
    
    if (!trackDuration || trackDuration <= 0) {
        logDebug("Bỏ qua thanh tiến trình - live stream hoặc thời lượng không xác định", { track: track?.title });
        return;
    }

    player.userdata.progressInterval = setInterval(async () => {
        if (!player?.userdata || player.userdata.paused || !player.userdata.controlsMessage || !track) {
            return;
        }

        player.userdata.currentTime = (player.userdata.currentTime || 0) + 3;

        if (player.userdata.currentTime % 15 === 0) {
            try {
                const embed = nowPlayingEmbed(player, track, player.userdata.requesterId);
                const hasAutoPlay = player.userdata.autoPlay !== false;
                const progressComponents = buildControls(!!player.userdata.paused, player.userdata.repeatMode ?? 0, hasAutoPlay);
                
                try {
                    const suggestionMenu = await createSuggestionMenu(track, "suggestion_select");
                    progressComponents.push(new ActionRowBuilder().addComponents(suggestionMenu));
                } catch (menuError) {
                    logDebug("Lỗi khi thêm menu vào cập nhật tiến trình", { error: menuError.message });
                    const fallbackMenu = new StringSelectMenuBuilder()
                        .setCustomId("suggestion_select")
                        .setPlaceholder("🎵 Menu gợi ý")
                        .setMinValues(1)
                        .setMaxValues(1)
                        .addOptions([
                            new StringSelectMenuOptionBuilder()
                                .setLabel("🎲 Phát ngẫu nhiên")
                                .setDescription("Để bot tự động chọn bài tiếp theo")
                                .setValue("random_next")
                                .setEmoji("🎲")
                        ]);
                    progressComponents.push(new ActionRowBuilder().addComponents(fallbackMenu));
                }
                
                await player.userdata.controlsMessage.edit({
                    embeds: [embed],
                    components: progressComponents,
                });
            } catch (e) {
                logDebug("Không thể cập nhật tiến trình", { error: e.message });
            }
        }
    }, 3000);
};

const downloadYouTubeVideo = async (url, format, interaction) => {
    if (!url || !format || !interaction) {
        return {
            success: false,
            embed: createEmbed("❌ LỖI", "Thiếu thông tin URL, định dạng, hoặc tương tác.", 0xff0000),
        };
    }

    try {
        const pythonPath = "python";
        const scriptPath = path.join(__dirname, "download.py");

        try {
            await fs.access(scriptPath);
        } catch {
            logDebug("File download.py không tồn tại", { path: scriptPath });
            return {
                success: false,
                embed: createEmbed(
                    "❌ LỖI",
                    "Không tìm thấy file download.py. Vui lòng kiểm tra thư mục dự án hoặc tạo file download.py.",
                    0xff0000
                ),
            };
        }

        const command = `${pythonPath} "${scriptPath}" "${url}" "${format}"`;
        const { stdout, stderr } = await execPromise(command);

        let result;
        try {
            result = JSON.parse(stdout);
        } catch (e) {
            logDebug("Lỗi phân tích JSON từ Python", { stdout, stderr, error: e.message });
            if (stderr.includes("ffmpeg not found") || stderr.includes("ffprobe not found")) {
                return {
                    success: false,
                    embed: createEmbed(
                        "❌ LỖI",
                        "FFmpeg không được cài đặt hoặc không tìm thấy. Vui lòng cài FFmpeg và thêm vào PATH hệ thống.",
                        0xff0000
                    ),
                };
            }
            return {
                success: false,
                embed: createEmbed("❌ LỖI", "Lỗi xử lý tải xuống: Đầu ra từ Python không hợp lệ. Vui lòng thử lại.", 0xff0000),
            };
        }

        if (!result?.success || !result?.filename) {
            logDebug("Lỗi tải xuống từ Python", { error: result?.error || "Không xác định", stderr });
            if (result?.error?.includes("ffmpeg") || result?.error?.includes("ffprobe")) {
                return {
                    success: false,
                    embed: createEmbed(
                        "❌ LỖI",
                        "FFmpeg không được cài đặt hoặc không tìm thấy. Vui lòng cài FFmpeg và thêm vào PATH hệ thống.",
                        0xff0000
                    ),
                };
            }
            return {
                success: false,
                embed: createEmbed("❌ LỖI", `Không thể tải video: ${result?.error || "Lỗi không xác định"}`, 0xff0000),
            };
        }

        const filePath = result.filename;
        try {
            await fs.access(filePath);
        } catch (e) {
            logDebug("File tải xuống không tồn tại", { filePath, error: e.message });
            return {
                success: false,
                embed: createEmbed("❌ LỖI", "File tải xuống không được tạo. Vui lòng thử lại.", 0xff0000),
            };
        }

        const fileSize = (await fs.stat(filePath)).size;
        const maxSize = 8 * 1024 * 1024;

        if (fileSize > maxSize) {
            return {
                success: false,
                embed: createEmbed("❌ LỖI", "File quá lớn (>8MB). Vui lòng chọn video ngắn hơn.", 0xff0000),
            };
        }

        const attachment = new AttachmentBuilder(filePath);
        const embed = createEmbed(
            "🎥 TẢI XUỐNG THÀNH CÔNG",
            `**${result.title || "Video YouTube"}** đã được tải xuống ở định dạng ${format.toUpperCase()}.`,
            0x00ff00
        );

        return { success: true, embed, attachment };
    } catch (error) {
        logDebug("Lỗi tải xuống", { error: error.message });
        if (error.message.includes("ffmpeg") || error.message.includes("ffprobe")) {
            return {
                success: false,
                embed: createEmbed(
                    "❌ LỖI",
                    "FFmpeg không được cài đặt hoặc không tìm thấy. Vui lòng cài FFmpeg và thêm vào PATH hệ thống.",
                    0xff0000
                ),
            };
        }
        return {
            success: false,
            embed: createEmbed("❌ LỖI", "Không thể tải video. Kiểm tra URL hoặc thử lại.", 0xff0000),
        };
    }
};

playerManager.on("trackStart", async (player, track) => {
    if (!player || !track) return;
    player.userdata = player.userdata || {};
    player.userdata.paused = false;
    player.userdata.currentTime = 0;
    
    if (player.userdata.autoPlay === undefined) {
        player.userdata.autoPlay = true;
    }

    await updateVoiceChannelStatus(player, track);

    const requesterId = player.userdata.requesterId;
    await ensureControllerMessage(player, track, requesterId);

    startProgressBar(player, track);

    if (player.userdata.lastControlsMessage && player.userdata.lastControlsMessage.id !== player.userdata.controlsMessage?.id) {
        await disableMessageButtons(player.userdata.lastControlsMessage);
    }
    player.userdata.lastControlsMessage = player.userdata.controlsMessage;
});

playerManager.on("trackAdd", (player, track) => {
    if (!player?.userdata?.channel || !track) return;
    const embed = createEmbed("🎶 ĐÃ THÊM", `**${track.title || "Không xác định"}**`);
    player.userdata.channel.send({ embeds: [embed] }).then((msg) => {
        setTimeout(() => {
            msg.delete().catch(() => {});
        }, 3000);
    });
});

playerManager.on("queueEnd", async (player) => {
    if (!player?.userdata) return;
    if (player.userdata.progressInterval) {
        clearInterval(player.userdata.progressInterval);
        player.userdata.progressInterval = null;
    }
    
    await clearVoiceChannelStatus(player);
    
    const currentTrack = player.currentTrack || player.track;
    if (currentTrack && player.userdata.autoPlay !== false) {
        const added = await autoAddSimilarTrack(player, currentTrack);
        if (added) {
            return;
        }
    }
    
    if (player.userdata?.controlsMessage) {
        await updateLeaveMessage(player.userdata.channel, player.userdata.controlsMessage);
    }
});

playerManager.on("empty", async (player) => {
    if (!player?.userdata) return;
    if (player.userdata.progressInterval) {
        clearInterval(player.userdata.progressInterval);
        player.userdata.progressInterval = null;
    }
    
    await clearVoiceChannelStatus(player);
    
    if (player.userdata?.controlsMessage) {
        await updateLeaveMessage(player.userdata.channel, player.userdata.controlsMessage);
    }
});

playerManager.on("playerDestroy", async (player) => {
    if (!player?.userdata) return;
    if (player.userdata.progressInterval) {
        clearInterval(player.userdata.progressInterval);
        player.userdata.progressInterval = null;
    }
    
    await clearVoiceChannelStatus(player);
    
    if (player.userdata?.controlsMessage) {
        await player.userdata.controlsMessage.edit({
            embeds: [createLeaveEmbed()],
            components: buildLeaveControls(),
        }).catch(() => {});
    }
});

playerManager.on("trackEnd", async (player, track) => {
    if (!player?.userdata || !track) return;
    if (player.userdata.progressInterval) {
        clearInterval(player.userdata.progressInterval);
        player.userdata.progressInterval = null;
    }
    
    player.userdata.currentTime = 0;
    
    const { loopCurrentTrack, loopQueue } = player.userdata;
    
    if (loopCurrentTrack) {
        await player.play(track.url);
    } else if (loopQueue && player.queue?.tracks?.length === 0) {
        logDebug("Loop player: Queue đã lặp lại");
    } else if (player.queue?.tracks?.length === 0 && player.userdata.autoPlay !== false) {
        await autoAddSimilarTrack(player, track);
    }
});

playerManager.on("error", async (player, error) => {
    logDebug("Lỗi trình phát", { error: error.message });
    if (!player?.userdata?.controlsMessage) return;
    const embed = createEmbed("❌ LỖI PHÁT NHẠC", "Lỗi khi phát nhạc. Đang thử kết nối lại...", 0xff0000);
    player.userdata.channel?.send({ embeds: [embed] }).then((msg) => {
        setTimeout(() => msg.delete().catch(() => {}), 5000);
    });
    try {
        if (player.connection?.state?.status === "disconnected" && player.userdata?.channel?.guild?.members?.me?.voice?.channel) {
            await player.connect(player.userdata.channel.guild.members.me.voice.channel);
            const currentTrack = player.currentTrack || player.track;
            if (currentTrack) {
                await player.play(currentTrack.url);
                logDebug("Đã kết nối lại và phát lại bài", { track: currentTrack.title || "Không xác định" });
            }
        }
    } catch (reconnectError) {
        logDebug("Lỗi kết nối lại", { error: reconnectError.message });
        if (player.userdata?.controlsMessage) {
            await updateLeaveMessage(player.userdata.channel, player.userdata.controlsMessage);
        }
        player.stop();
        player.destroy();
    }
});

const { ActivityType } = require("discord.js");

client.once("ready", async () => {
    logDebug(`✅ Đăng nhập với tên ${client.user?.tag || "Không xác định"}`);

    client.user?.setStatus("online");

    const activities = [
        { name: "/play | 0play", type: ActivityType.Listening },
        { name: "Chọc Chó", type: ActivityType.Playing },
        { name: "4.805.158 Server", type: ActivityType.Watching },
        { name: "E là không thể", type: ActivityType.Streaming, url: "https://youtu.be/stvWuowo1dU?si=yFYuzhdwnf_pev66" },
    ];

    let i = 0;

    // set activity đầu tiên ngay khi khởi động
    client.user?.setActivity({
        name: activities[0].name,
        type: activities[0].type,
        timestamps: { start: Date.now() }
    });

    // xoay vòng 5s đổi 1 trạng thái
    setInterval(() => {
        i = (i + 1) % activities.length;
        const activity = activities[i];
        client.user?.setActivity({
            name: activity.name,
            type: activity.type,
            timestamps: { start: Date.now() }
        });
    }, 10000);
});
client.on("ready", async () => {


    const commands = [
        new SlashCommandBuilder()
            .setName("play")
            .setDescription("Phát bài hát từ YouTube, Spotify, hoặc SoundCloud")
            .addStringOption(option =>
                option.setName("query")
                    .setDescription("URL hoặc từ khóa bài hát")
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName("leave")
            .setDescription("Ngắt kết nối bot khỏi kênh thoại"),
        new SlashCommandBuilder()
            .setName("queue")
            .setDescription("Xem danh sách bài hát trong hàng đợi"),
        new SlashCommandBuilder()
            .setName("help")
            .setDescription("Hiển thị hướng dẫn sử dụng bot và các nút điều khiển"),
        new SlashCommandBuilder()
            .setName("dow")
            .setDescription("Tải xuống video YouTube ở định dạng MP3, MP4, hoặc AVI")
            .addStringOption(option =>
                option.setName("link")
                    .setDescription("URL video YouTube cần tải")
                    .setRequired(true)
            ),
    ];

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        logDebug("Bắt đầu đăng ký slash commands");
        await rest.put(Routes.applicationCommands(client.user?.id || ""), {
            body: commands,
        });
        logDebug("Đã đăng ký slash commands thành công");
    } catch (error) {
        logDebug("Lỗi khi đăng ký slash commands", { error: error.message });
    }
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    if (message.mentions.has(client.user)) {
        const attachment = new AttachmentBuilder("assets/banner.png");
        const embed = createTagEmbed(message.author);
        return message.channel.send({ embeds: [embed], files: [attachment] });
    }

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    if (command === "play") {
        if (!args[0]) {
            return message.channel.send({
                embeds: [createEmbed("❌ LỖI", "Vui lòng cung cấp URL hoặc từ khóa.", 0xff0000)],
            });
        }
        if (!message.member?.voice?.channel) {
            return message.channel.send({
                embeds: [createEmbed("❌ LỖI", "Vui lòng tham gia kênh thoại trước.", 0xff0000)],
            });
        }

        const player = await playerManager.create(message.guild.id, {
            userdata: { 
                channel: message.channel, 
                requesterId: message.author.id,
                autoPlay: true
            },
            selfDeaf: true,
        });

        try {
            if (!player?.connection) await player.connect(message.member.voice.channel);
            const ok = await player.play(args.join(" ")).catch((e) => {
                logDebug("Lỗi khi phát", { error: e.message });
                return null;
            });
            if (ok) {
                try {
                    await message.delete();
                } catch {}
                return message.channel.send({ embeds: [createEmbed("🎶 ĐÃ THÊM", `<${args.join(" ")}>`)] }).then((msg) => {
                    setTimeout(() => {
                        msg.delete().catch(() => {});
                    }, 3000);
                });
            }
            return message.channel.send({
                embeds: [createEmbed("❌ LỖI", "Không tìm thấy kết quả.", 0xff0000)],
            });
        } catch (err) {
            logDebug("Lỗi khi phát", { error: err.message });
            return message.channel.send({
                embeds: [createEmbed("❌ LỖI", "Không thể tham gia kênh thoại.", 0xff0000)],
            });
        }
    }

    if (command === "leave") {
        const player = playerManager.get(message.guild.id);
        if (!player) return;

        try {
            if (player.userdata?.controlsMessage) {
                await updateLeaveMessage(player.userdata.channel, player.userdata.controlsMessage);
            } else if (player.userdata?.channel) {
                await player.userdata.channel.send({
                    embeds: [createLeaveEmbed()],
                    components: buildLeaveControls(),
                });
            }
        } catch (e) {
            logDebug("Lỗi khi cập nhật embed rời kênh", { error: e.message });
        }
        player.stop();
        player.destroy();
    }
    
    if (command === "queue" || command === "q") {
        const player = playerManager.get(message.guild.id);
        if (!player) {
            return message.channel.send({
                embeds: [createEmbed("❌ LỖI", "Không có player nào đang chạy.", 0xff0000)],
            });
        }

        const queue = player.queue?.tracks || [];
        const currentTrack = player.currentTrack || player.track;
        
        if (!currentTrack && queue.length === 0) {
            return message.channel.send({
                embeds: [createEmbed("📋 HÀNG ĐỌI", "Hàng đợi trống.")],
            });
        }

        let description = "";
        if (currentTrack) {
            description += `**🎵 Đang phát:**\n${currentTrack.title || "Không xác định"}\n\n`;
        }
        if (queue.length > 0) {
            description += "**📋 Tiếp theo:**\n";
            queue.slice(0, 10).forEach((track, index) => {
                description += `${index + 1}. ${track.title || "Không xác định"}\n`;
            });
            if (queue.length > 10) {
                description += `\n*...và ${queue.length - 10} bài khác*`;
            }
        } else {
            description += "*Không có bài nào trong hàng đợi*";
            if (player.userdata?.autoPlay !== false) {
                description += "\n🎲 *Auto-play đang bật*";
            }
        }

        const embed = createEmbed("📋 HÀNG ĐỌI PHÁT NHẠC", description);
        message.channel.send({ embeds: [embed] });
    }

    if (command === "help") {
        const attachment = new AttachmentBuilder("assets/banner.png");
        const embed = createHelpEmbed(message.author);
        return message.channel.send({
            embeds: [embed],
            files: [attachment],
            components: buildLeaveControls(),
        });
    }

    if (command === "dow") {
        if (!args[0]) {
            return message.channel.send({
                embeds: [createEmbed("❌ LỖI", "Vui lòng cung cấp URL YouTube.", 0xff0000)],
            });
        }

        const url = args.join(" ");
        const downloadId = generateDownloadId();
        downloadUrlMap.set(downloadId, url);
        
        setTimeout(() => {
            downloadUrlMap.delete(downloadId);
        }, 5 * 60 * 1000);

        const embed = createEmbed("🎥 CHỌN ĐỊNH DẠNG TẢI XUỐNG", "Vui lòng chọn định dạng tải về của bạn:", 0xefe9dc);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`download_mp3_${downloadId}`).setLabel("MP3").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`download_mp4_${downloadId}`).setLabel("MP4").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`download_avi_${downloadId}`).setLabel("AVI").setStyle(ButtonStyle.Primary)
        );

        try {
            await message.delete();
        } catch {}
        return message.channel.send({ embeds: [embed], components: [row] });
    }

    if (command === "debug") {
        const player = playerManager.get(message.guild.id);
        if (!player) {
            return message.channel.send("No player found");
        }

        const debug = {
            currentTrack: player.currentTrack?.title || player.track?.title || "None",
            queueLength: player.queue?.tracks?.length || 0,
            hasQueue: !!player.queue,
            queueSize: player.queue?.size || "undefined",
            autoPlay: player.userdata?.autoPlay,
            suggestions: player.userdata?.currentSuggestions?.length || 0,
            playerMethods: Object.getOwnPropertyNames(player).filter(prop => typeof player[prop] === 'function').slice(0, 10)
        };

        return message.channel.send(`\`\`\`json\n${JSON.stringify(debug, null, 2)}\n\`\`\``);
    }
});

client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === "play") {
            const query = interaction.options.getString("query");
            const member = interaction.member;

            if (!member?.voice?.channel) {
                return interaction.reply({
                    embeds: [createEmbed("❌ LỖI", "Vui lòng tham gia kênh thoại trước.", 0xff0000)],
                    ephemeral: true,
                });
            }

            await interaction.deferReply();
            const player = await playerManager.create(interaction.guild.id, {
                userdata: { 
                    channel: interaction.channel, 
                    requesterId: interaction.user.id,
                    autoPlay: true
                },
                selfDeaf: true,
            });

            try {
                if (!player?.connection) await player.connect(member.voice.channel);
                const ok = await player.play(query).catch((e) => {
                    logDebug("Lỗi khi phát", { error: e.message });
                    return null;
                });
                if (ok) {
                    return interaction.editReply({
                        embeds: [createEmbed("🎶 ĐÃ THÊM", `<${query}>`)],
                    });
                }
                return interaction.editReply({
                    embeds: [createEmbed("❌ LỖI", "Không tìm thấy kết quả.", 0xff0000)],
                    ephemeral: true,
                });
            } catch (err) {
                logDebug("Lỗi khi phát", { error: err.message });
                return interaction.editReply({
                    embeds: [createEmbed("❌ LỖI", "Không thể tham gia kênh thoại.", 0xff0000)],
                    ephemeral: true,
                });
            }
        }

        if (commandName === "leave") {
            await interaction.deferReply();
            const player = playerManager.get(interaction.guild.id);
            if (!player) return interaction.editReply({
                embeds: [createEmbed("❌ LỖI", "Không có player nào đang chạy.", 0xff0000)],
                ephemeral: true,
            });

            player.stop();
            player.destroy();
            return interaction.editReply({ embeds: [createLeaveEmbed()] });
        }

        if (commandName === "queue") {
            await interaction.deferReply();
            const player = playerManager.get(interaction.guild.id);
            if (!player) {
                return interaction.editReply({
                    embeds: [createEmbed("❌ LỖI", "Không có player nào đang chạy.", 0xff0000)],
                    ephemeral: true,
                });
            }

            const queue = player.queue?.tracks || [];
            const currentTrack = player.currentTrack || player.track;

            let description = "";
            if (currentTrack) description += `**🎵 Đang phát:**\n${currentTrack.title || "Không xác định"}\n\n`;
            if (queue.length > 0) {
                description += "**📋 Tiếp theo:**\n";
                queue.slice(0, 10).forEach((track, i) => {
                    description += `${i + 1}. ${track.title || "Không xác định"}\n`;
                });
            } else {
                description += "*Không có bài nào trong hàng đợi*";
                if (player.userdata?.autoPlay !== false) {
                    description += "\n🎲 *Auto-play đang bật*";
                }
            }

            return interaction.editReply({
                embeds: [createEmbed("📋 HÀNG ĐỌI PHÁT NHẠC", description)]
            });
        }

        if (commandName === "help") {
            await interaction.deferReply();
            const attachment = new AttachmentBuilder("assets/banner.png");
            const embed = createHelpEmbed(interaction.user);
            return interaction.editReply({
                embeds: [embed],
                files: [attachment],
                components: buildLeaveControls(),
            });
        }

        if (commandName === "dow") {
            await interaction.deferReply();
            const url = interaction.options.getString("link");
            const downloadId = generateDownloadId();
            downloadUrlMap.set(downloadId, url);
            
            setTimeout(() => {
                downloadUrlMap.delete(downloadId);
            }, 5 * 60 * 1000);

            const embed = createEmbed("🎥 CHỌN ĐỊNH DẠNG TẢI XUỐNG", "Vui lòng chọn định dạng tải về của bạn:", 0xefe9dc);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`download_mp3_${downloadId}`).setLabel("MP3").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`download_mp4_${downloadId}`).setLabel("MP4").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`download_avi_${downloadId}`).setLabel("AVI").setStyle(ButtonStyle.Primary)
            );
            return interaction.editReply({ embeds: [embed], components: [row] });
        }
    }
        
    if (interaction.isButton() && interaction.customId === "add_next") {
        const modal = new ModalBuilder().setCustomId("add_next_modal").setTitle("Thêm bài hát kế tiếp");
        const input = new TextInputBuilder()
            .setCustomId("song_url")
            .setLabel("Dán link bài hát (YouTube/Spotify/SoundCloud)")
            .setPlaceholder("https://...")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "add_next_modal") {
        const player = playerManager.get(interaction.guild.id);
        const url = interaction.fields.getTextInputValue("song_url")?.trim();

        if (!player) {
            return interaction.reply({
                embeds: [createEmbed("❌", "Không có hàng đợi nào đang chạy. Dùng `0play <link>` trước.", 0xff0000)],
                ephemeral: true,
            });
        }
        if (!url) {
            return interaction.reply({
                embeds: [createEmbed("❌", "Vui lòng dán link hợp lệ.", 0xff0000)],
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: false });
        const result = await addNext(player, url, interaction.user);
        if (result) {
            const trackTitle = result.title || "Không xác định";
            const currentTrack = player.currentTrack || player.track;
            if (currentTrack && player.userdata?.controlsMessage) {
                const updatedEmbed = nowPlayingEmbed(player, currentTrack, player.userdata.requesterId);
                const hasAutoPlay = player.userdata.autoPlay !== false;
                const components = [
                    ...buildControls(!!player.userdata.paused, player.userdata.repeatMode ?? 0, hasAutoPlay)
                ];
                
                try {
                    const suggestionMenu = await createSuggestionMenu(currentTrack, "suggestion_select");
                    components.push(new ActionRowBuilder().addComponents(suggestionMenu));
                } catch (menuError) {
                    logDebug("Lỗi khi tạo lại menu", { error: menuError.message });
                }
                
                try {
                    await player.userdata.controlsMessage.edit({
                        embeds: [updatedEmbed],
                        components: components,
                    });
                } catch (updateError) {
                    logDebug("Không thể cập nhật tin nhắn điều khiển", { error: updateError.message });
                }
            }
            
            return interaction.editReply({
                embeds: [createEmbed("🎶 ĐÃ THÊM", `**${trackTitle}** đã được thêm vào hàng đợi\n📋 Hàng đợi hiện có: **${(player.queue?.tracks?.length || 0)}** bài`)],
            }).then((msg) => {
                setTimeout(() => {
                    msg.delete().catch(() => {});
                }, 3000);
            });
        } else {
            return interaction.editReply({
                embeds: [createEmbed("❌", "Không thể thêm bài. Kiểm tra lại link.", 0xff0000)],
                ephemeral: true,
            });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "suggestion_select") {
        const player = playerManager.get(interaction.guild.id);
        if (!player) {
            return interaction.reply({
                embeds: [createEmbed("❌", "Không có player nào đang chạy.", 0xff0000)],
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: false });
        const selectedValue = interaction.values[0];
        
        if (selectedValue === "random_next") {
            player.userdata.autoPlay = true;
            await updateControls(player);
            return interaction.editReply({
                embeds: [createEmbed("🎲 TỰ ĐỘNG", "Đã bật chế độ tự động phát nhạc ngẫu nhiên!")],
                ephemeral: true,
            });
        }

        if (selectedValue === "no_suggestions") {
            return interaction.editReply({
                embeds: [createEmbed("🎵 GỢI Ý", "Không tìm thấy bài hát tương tự. Hãy thử:\n• Ấn nút ➕ để thêm bài thủ công\n• Chọn 🎲 Phát ngẫu nhiên để bật auto-play")],
                ephemeral: true,
            });
        }

        if (selectedValue.startsWith("suggestion_")) {
            const index = parseInt(selectedValue.split("_")[1]);
            const suggestions = player.userdata.currentSuggestions;
            
            if (suggestions && suggestions[index]) {
                const selectedTrack = suggestions[index];
                const result = await addNext(player, selectedTrack.url, interaction.user);
                
                if (result) {
                    const currentTrack = player.currentTrack || player.track;
                    if (currentTrack) {
                        const updatedEmbed = nowPlayingEmbed(player, currentTrack, player.userdata.requesterId);
                        const hasAutoPlay = player.userdata.autoPlay !== false;
                        const components = [
                            ...buildControls(!!player.userdata.paused, player.userdata.repeatMode ?? 0, hasAutoPlay)
                        ];
                        
                        try {
                            const suggestionMenu = await createSuggestionMenu(currentTrack, "suggestion_select");
                            components.push(new ActionRowBuilder().addComponents(suggestionMenu));
                        } catch (menuError) {
                            logDebug("Lỗi khi tạo lại menu", { error: menuError.message });
                        }
                        
                        if (player.userdata.controlsMessage) {
                            try {
                                await player.userdata.controlsMessage.edit({
                                    embeds: [updatedEmbed],
                                    components: components,
                                });
                            } catch (updateError) {
                                logDebug("Không thể cập nhật tin nhắn điều khiển", { error: updateError.message });
                            }
                        }
                    }
                    
                    return interaction.editReply({
                        embeds: [createEmbed("🎵 ĐÃ CHỌN", `**${selectedTrack.title || "Không xác định"}** đã được thêm vào hàng đợi\n📋 Hàng đợi hiện có: **${(player.queue?.tracks?.length || 0)}** bài`)],
                    }).then((msg) => {
                        setTimeout(() => {
                            msg.delete().catch(() => {});
                        }, 5000);
                    });
                } else {
                    return interaction.editReply({
                        embeds: [createEmbed("❌", "Không thể thêm bài hát đã chọn. Thử lại sau.", 0xff0000)],
                        ephemeral: true,
                    });
                }
            } else {
                return interaction.editReply({
                    embeds: [createEmbed("❌", "Lựa chọn không hợp lệ. Menu có thể đã cũ, thử chọn lại.", 0xff0000)],
                    ephemeral: true,
                });
            }
        }

        return interaction.editReply({
            embeds: [createEmbed("❌", "Lựa chọn không hợp lệ.", 0xff0000)],
            ephemeral: true,
        });
    }

    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith("download_")) {
        await interaction.deferReply();
        const [_, format, downloadId] = interaction.customId.split("_");
        
        const url = downloadUrlMap.get(downloadId);
        if (!url) {
            return interaction.editReply({
                embeds: [createEmbed("❌ LỖI", "Liên kết đã hết hạn. Vui lòng sử dụng lại lệnh dow.", 0xff0000)],
                ephemeral: true,
            });
        }
        
        const result = await downloadYouTubeVideo(url, format, interaction);
        
        downloadUrlMap.delete(downloadId);
        
        if (result.success) {
            return interaction.editReply({
                embeds: [result.embed],
                files: [result.attachment],
            });
        } else {
            return interaction.editReply({
                embeds: [result.embed],
                ephemeral: true,
            });
        }
    }

    const player = playerManager.get(interaction.guild.id);
    if (!player) {
        return interaction.reply({
            embeds: [createEmbed("❌", "Không có hàng đợi trong server này.", 0xff0000)],
            ephemeral: true,
        });
    }

    try {
        await interaction.deferReply({ ephemeral: true });
        switch (interaction.customId) {
            case "toggle_autoplay": {
                player.userdata.autoPlay = !player.userdata.autoPlay;
                await updateControls(player);
                const status = player.userdata.autoPlay ? "BẬT" : "TẮT";
                const emoji = player.userdata.autoPlay ? "🎲" : "⏹";
                return interaction.editReply({
                    embeds: [createEmbed(`${emoji} AUTO-PLAY`, `Đã ${status} chế độ tự động phát nhạc`)],
                });
            }
            case "queue": {
                const queue = player.queue?.tracks || [];
                const currentTrack = player.currentTrack || player.track;
                
                if (!currentTrack && queue.length === 0) {
                    return interaction.editReply({
                        embeds: [createEmbed("📋 HÀNG ĐỌI", "Hàng đợi trống.")],
                    });
                }

                let description = "";
                if (currentTrack) {
                    description += `**🎵 Đang phát:**\n${currentTrack.title || "Không xác định"}\n\n`;
                }
                if (queue.length > 0) {
                    description += "**📋 Tiếp theo:**\n";
                    queue.slice(0, 5).forEach((track, index) => {
                        description += `${index + 1}. ${track.title || "Không xác định"}\n`;
                    });
                    if (queue.length > 5) {
                        description += `\n*...và ${queue.length - 5} bài khác*`;
                    }
                } else {
                    description += "*Không có bài nào trong hàng đợi*";
                    if (player.userdata?.autoPlay !== false) {
                        description += "\n🎲 *Auto-play đang bật*";
                    }
                }

                return interaction.editReply({
                    embeds: [createEmbed("📋 HÀNG ĐỌI PHÁT NHẠC", description)],
                });
            }
            case "decrease_volume": {
                const volDown = Math.max(0, (player.volume ?? 100) - 10);
                player.setVolume(volDown);
                return interaction.editReply({
                    embeds: [createEmbed("🔉 ÂM LƯỢNG", `Giảm còn **${volDown}%**`)],
                });
            }
            case "increase_volume": {
                const volUp = Math.min(100, (player.volume ?? 100) + 10);
                player.setVolume(volUp);
                return interaction.editReply({
                    embeds: [createEmbed("🔊 ÂM LƯỢNG", `Tăng lên **${volUp}%**`)],
                });
            }
            case "pause": {
                const ok = await safePause(player);
                if (!ok)
                    return interaction.editReply({
                        embeds: [createEmbed("❌", "Không thể tạm dừng.", 0xff0000)],
                    });
                player.userdata.paused = true;
                await updateControls(player);
                return interaction.editReply({
                    embeds: [createEmbed("⏸ TẠM DỪNG", "Đã tạm dừng bài hát.")],
                });
            }
            case "resume": {
                const ok = await safeResume(player);
                if (!ok)
                    return interaction.editReply({
                        embeds: [createEmbed("❌", "Không thể tiếp tục phát.", 0xff0000)],
                    });
                player.userdata.paused = false;
                await updateControls(player);
                return interaction.editReply({
                    embeds: [createEmbed("▶ TIẾP TỤC", "Đã tiếp tục bài hát.")],
                });
            }
            case "skip": {
                if (player.userdata.progressInterval) {
                    clearInterval(player.userdata.progressInterval);
                    player.userdata.progressInterval = null;
                }
                
                const hasNextTrack = player.queue?.tracks && player.queue.tracks.length > 0;
                
                if (hasNextTrack) {
                    player.userdata.paused = false;
                    player.skip();
                    return interaction.editReply({
                        embeds: [createEmbed("⏭ BỎ QUA", "Đã bỏ qua bài hiện tại, đang phát bài tiếp theo.")],
                    });
                } else {
                    const currentTrack = player.currentTrack || player.track;
                    if (player.userdata.autoPlay && currentTrack) {
                        const added = await autoAddSimilarTrack(player, currentTrack);
                        if (added) {
                            player.userdata.paused = false;
                            player.skip();
                            return interaction.editReply({
                                embeds: [createEmbed("⏭ BỎ QUA", "Đã bỏ qua bài hiện tại, tự động thêm bài tương tự.")],
                            });
                        } else {
                            player.stop();
                            await updateLeaveMessage(player.userdata.channel, player.userdata.controlsMessage);
                            return interaction.editReply({
                                embeds: [createEmbed("⏭ BỎ QUA", "Đã bỏ qua bài cuối cùng, không tìm thấy bài tương tự để phát tiếp.")],
                            });
                        }
                    } else {
                        player.stop();
                        await updateLeaveMessage(player.userdata.channel, player.userdata.controlsMessage);
                        return interaction.editReply({
                            embeds: [createEmbed("⏭ BỎ QUA", "Đã bỏ qua bài cuối cùng, dừng phát nhạc.")],
                        });
                    }
                }
            }
            case "previous": {
                if (!player.previousTracks || player.previousTracks.length === 0) {
                    return interaction.editReply({
                        embeds: [createEmbed("❌", "Không có bài trước.", 0xff0000)],
                    });
                }
                if (player.userdata.progressInterval) {
                    clearInterval(player.userdata.progressInterval);
                    player.userdata.progressInterval = null;
                }
                player.userdata.paused = false;
                player.previous();
                return interaction.editReply({
                    embeds: [createEmbed("⏮ QUAY LẠI", "Đã phát bài trước.")],
                });
            }
            case "loop": {
                const currentMode = player.userdata.repeatMode ?? 0;
                const mode = (currentMode + 1) % 3;
                player.userdata.repeatMode = mode;

                if (mode === 1) {
                    player.userdata.loopCurrentTrack = true;
                } else if (mode === 2) {
                    player.userdata.loopQueue = true;
                } else {
                    player.userdata.loopCurrentTrack = false;
                    player.userdata.loopQueue = false;
                }

                await updateControls(player);
                return interaction.editReply({
                    embeds: [createEmbed("LOOP", repeatLabel(mode))],
                });
            }
            case "stop": {
                if (player.userdata.progressInterval) {
                    clearInterval(player.userdata.progressInterval);
                    player.userdata.progressInterval = null;
                }
                player.stop();
                await updateLeaveMessage(player.userdata.channel, player.userdata.controlsMessage);
                return interaction.editReply({
                    embeds: [createEmbed("⏹ DỪNG", "Đã dừng phát nhạc.")],
                });
            }
        }
    } catch (err) {
        logDebug("Lỗi tương tác", { error: err.message });
        return interaction[interaction.deferred ? "editReply" : "reply"]({
            embeds: [createEmbed("❌ LỖI", "Có lỗi xảy ra khi xử lý nút.", 0xff0000)],
            ephemeral: true,
        });
    }
});

client.login(process.env.TOKEN);