const { EmbedBuilder } = require("discord.js");

// Enhanced error handling utilities
const handleError = (error, context = '') => {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error(`[ERROR] ${context}:`, errorMessage);
    return errorMessage;
};

const safeExecute = async (fn, fallback = null, context = '') => {
    try {
        return await fn();
    } catch (error) {
        handleError(error, context);
        return fallback;
    }
};

const safeSend = async (channel, content, timeout = 3000) => {
    try {
        const msg = await channel.send(content);
        if (timeout > 0) {
            setTimeout(() => msg.delete().catch(() => {}), timeout);
        }
        return msg;
    } catch (error) {
        handleError(error, 'safeSend');
        return null;
    }
};

// Optimized progress bar with caching
const progressBarCache = new Map();
const createProgressBar = (currentTime, totalDuration) => {
    if (!totalDuration || totalDuration <= 0) return "00:00";
    
    const cacheKey = `${Math.floor(currentTime)}_${Math.floor(totalDuration)}`;
    if (progressBarCache.has(cacheKey)) {
        return progressBarCache.get(cacheKey);
    }
    
    const totalBlocks = 10;
    const filledBlocks = Math.min(Math.floor((currentTime / totalDuration) * totalBlocks), totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    
    const progressBar = "█".repeat(filledBlocks) + "<a:ga_vn:1383145143711830238>" + "…".repeat(emptyBlocks);
    const result = `${formatDuration(currentTime)} ${progressBar} ${formatDuration(totalDuration)}`;
    
    // Cache for 3 seconds
    progressBarCache.set(cacheKey, result);
    setTimeout(() => progressBarCache.delete(cacheKey), 3000);
    
    return result;
};

const formatDuration = (durationInSeconds) => {
    if (!durationInSeconds || isNaN(durationInSeconds) || durationInSeconds <= 0) {
        return "00:00";
    }
    
    // Normalize duration (handle milliseconds)
    const duration = durationInSeconds > 86400 ? Math.floor(durationInSeconds / 1000) : durationInSeconds;
    
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.floor(duration % 60);
    
    return hours > 0 
        ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
        : `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const createEmbed = (title, description, color = 0xefe9dc) => {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: "🎶 LEEVY MUSIC - Music Bot" });
};

const extractYouTubeChannel = (url) => {
    if (!url) return null;
    try {
        const match = url.match(/[&?]channel=([^&]+)/) || url.match(/channel\/([^/?]+)/) || url.match(/user\/([^/?]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
};

module.exports = { 
    createEmbed, 
    createProgressBar, 
    formatDuration, 
    extractYouTubeChannel,
    handleError,
    safeExecute,
    safeSend
};