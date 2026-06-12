// ============================================================
// 📋 디스코드 로깅 봇 - 채팅/입퇴장/음성방 활동 추적
// discord.js v14
// ============================================================

const { Client, GatewayIntentBits, Partials, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ─── 설정 불러오기 ───
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,      // 채팅 내용 읽기 (개발자 포털에서 활성화 필요)
        GatewayIntentBits.GuildMembers,        // 입퇴장 감지 (개발자 포털에서 활성화 필요)
        GatewayIntentBits.GuildVoiceStates,    // 음성방 감지
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// ─── 음성방 입장 시간 기록용 ───
// key: userId, value: { channelId, channelName, joinedAt }
const voiceSessions = new Map();

// ─── 음성 활동 누적 통계 (파일 저장) ───
const STATS_FILE = path.join(__dirname, 'voice_stats.json');
let voiceStats = {};
if (fs.existsSync(STATS_FILE)) {
    try { voiceStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch (e) { voiceStats = {}; }
}
function saveStats() {
    fs.writeFileSync(STATS_FILE, JSON.stringify(voiceStats, null, 2));
}

// ─── 시간 포맷 (초 → "X시간 Y분 Z초") ───
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    let result = '';
    if (h > 0) result += `${h}시간 `;
    if (m > 0) result += `${m}분 `;
    result += `${s}초`;
    return result.trim();
}

// ─── 로그 채널 가져오기 ───
function getLogChannel(guild, type) {
    const channelId = config.logChannels[type] || config.logChannels.default;
    if (!channelId) return null;
    return guild.channels.cache.get(channelId);
}

// ─── 로그 전송 ───
async function sendLog(guild, type, embed) {
    const channel = getLogChannel(guild, type);
    if (!channel) return;
    try {
        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error(`[로그 전송 실패] ${type}:`, e.message);
    }
}

// ============================================================
// ✅ 봇 준비 완료
// ============================================================
client.once('ready', () => {
    console.log('============================================');
    console.log(`✅ 봇 로그인 완료: ${client.user.tag}`);
    console.log(`📡 서버 ${client.guilds.cache.size}개에서 작동 중`);
    console.log('============================================');
    client.user.setActivity('서버 활동 감시 중 👀');
});

// ============================================================
// 💬 채팅 로그
// ============================================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    // 콘솔 출력
    console.log(`[💬 채팅] #${message.channel.name} | ${message.author.tag}: ${message.content}`);

    // 명령어 처리
    if (message.content === '!음성통계' || message.content === '!통계') {
        const guildStats = voiceStats[message.guild.id] || {};
        const sorted = Object.entries(guildStats)
            .sort((a, b) => b[1].totalSeconds - a[1].totalSeconds)
            .slice(0, 10);

        if (sorted.length === 0) {
            return message.reply('아직 음성방 활동 기록이 없어요.');
        }

        const embed = new EmbedBuilder()
            .setTitle('🎙️ 음성방 활동 TOP 10')
            .setColor(0x5865F2)
            .setDescription(
                sorted.map(([userId, data], i) =>
                    `**${i + 1}.** <@${userId}> — ${formatDuration(data.totalSeconds)} (입장 ${data.joinCount}회)`
                ).join('\n')
            )
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    if (message.content === '!내통계') {
        const data = voiceStats[message.guild.id]?.[message.author.id];
        if (!data) return message.reply('아직 음성방 활동 기록이 없어요.');
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${message.author.username}님의 음성 활동`)
            .setColor(0x57F287)
            .addFields(
                { name: '총 이용 시간', value: formatDuration(data.totalSeconds), inline: true },
                { name: '입장 횟수', value: `${data.joinCount}회`, inline: true },
            )
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    // 채팅 로그 채널에 기록 (로그 채널 자체의 메시지는 무시)
    if (config.logChat) {
        const logChannel = getLogChannel(message.guild, 'chat');
        if (logChannel && message.channel.id !== logChannel.id) {
            const embed = new EmbedBuilder()
                .setColor(0x95A5A6)
                .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
                .setDescription(message.content || '*(내용 없음 - 이미지/파일)*')
                .addFields({ name: '채널', value: `<#${message.channel.id}>`, inline: true })
                .setFooter({ text: `유저 ID: ${message.author.id}` })
                .setTimestamp();
            if (message.attachments.size > 0) {
                embed.addFields({ name: '첨부파일', value: message.attachments.map(a => a.url).join('\n').slice(0, 1024) });
            }
            await sendLog(message.guild, 'chat', embed);
        }
    }
});

// ============================================================
// 🗑️ 메시지 삭제 로그
// ============================================================
client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;
    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🗑️ 메시지 삭제됨')
        .setAuthor({ name: message.author?.tag || '알 수 없음', iconURL: message.author?.displayAvatarURL() })
        .setDescription(message.content || '*(내용 알 수 없음)*')
        .addFields({ name: '채널', value: `<#${message.channel.id}>`, inline: true })
        .setTimestamp();
    await sendLog(message.guild, 'chat', embed);
});

// ============================================================
// ✏️ 메시지 수정 로그
// ============================================================
client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (oldMsg.content === newMsg.content) return;
    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('✏️ 메시지 수정됨')
        .setAuthor({ name: newMsg.author.tag, iconURL: newMsg.author.displayAvatarURL() })
        .addFields(
            { name: '수정 전', value: (oldMsg.content || '*(알 수 없음)*').slice(0, 1024) },
            { name: '수정 후', value: (newMsg.content || '*(없음)*').slice(0, 1024) },
            { name: '채널', value: `<#${newMsg.channel.id}>`, inline: true },
        )
        .setTimestamp();
    await sendLog(newMsg.guild, 'chat', embed);
});

// ============================================================
// 📥 서버 입장 로그
// ============================================================
client.on('guildMemberAdd', async (member) => {
    console.log(`[📥 입장] ${member.user.tag} 님이 서버에 들어왔습니다.`);
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('📥 멤버 입장')
        .setThumbnail(member.user.displayAvatarURL())
        .setDescription(`${member} (${member.user.tag}) 님이 서버에 들어왔습니다.`)
        .addFields(
            { name: '계정 생성일', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: '현재 멤버 수', value: `${member.guild.memberCount}명`, inline: true },
        )
        .setFooter({ text: `유저 ID: ${member.id}` })
        .setTimestamp();
    await sendLog(member.guild, 'member', embed);
});

// ============================================================
// 📤 서버 퇴장 로그
// ============================================================
client.on('guildMemberRemove', async (member) => {
    console.log(`[📤 퇴장] ${member.user.tag} 님이 서버에서 나갔습니다.`);

    // 음성방에 있던 상태로 나갔으면 세션 정리
    if (voiceSessions.has(member.id)) {
        voiceSessions.delete(member.id);
    }

    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('📤 멤버 퇴장')
        .setThumbnail(member.user.displayAvatarURL())
        .setDescription(`**${member.user.tag}** 님이 서버에서 나갔습니다.`)
        .addFields(
            { name: '서버 가입일', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '알 수 없음', inline: true },
            { name: '현재 멤버 수', value: `${member.guild.memberCount}명`, inline: true },
        )
        .setFooter({ text: `유저 ID: ${member.id}` })
        .setTimestamp();
    await sendLog(member.guild, 'member', embed);
});

// ============================================================
// 🎙️ 음성방 활동 로그 (입장/퇴장/이동/뮤트 등)
// ============================================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const guild = newState.guild;
    const userId = member.id;

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    // ── 1) 음성방 입장 ──
    if (!oldChannel && newChannel) {
        voiceSessions.set(userId, {
            channelId: newChannel.id,
            channelName: newChannel.name,
            joinedAt: Date.now(),
        });
        console.log(`[🎙️ 음성 입장] ${member.user.tag} → ${newChannel.name}`);

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🎙️ 음성방 입장')
            .setDescription(`${member} 님이 **${newChannel.name}** 에 들어왔습니다.`)
            .addFields({ name: '현재 인원', value: `${newChannel.members.filter(m => !m.user.bot).size}명`, inline: true })
            .setFooter({ text: `유저 ID: ${userId}` })
            .setTimestamp();
        await sendLog(guild, 'voice', embed);
        return;
    }

    // ── 2) 음성방 퇴장 ──
    if (oldChannel && !newChannel) {
        const session = voiceSessions.get(userId);
        let durationText = '알 수 없음';
        let durationSeconds = 0;

        if (session) {
            durationSeconds = Math.floor((Date.now() - session.joinedAt) / 1000);
            durationText = formatDuration(durationSeconds);
            voiceSessions.delete(userId);

            // 누적 통계 저장
            if (!voiceStats[guild.id]) voiceStats[guild.id] = {};
            if (!voiceStats[guild.id][userId]) {
                voiceStats[guild.id][userId] = { totalSeconds: 0, joinCount: 0, lastSeen: null };
            }
            voiceStats[guild.id][userId].totalSeconds += durationSeconds;
            voiceStats[guild.id][userId].joinCount += 1;
            voiceStats[guild.id][userId].lastSeen = new Date().toISOString();
            saveStats();
        }

        console.log(`[🎙️ 음성 퇴장] ${member.user.tag} ← ${oldChannel.name} (체류: ${durationText})`);

        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('🎙️ 음성방 퇴장')
            .setDescription(`${member} 님이 **${oldChannel.name}** 에서 나갔습니다.`)
            .addFields(
                { name: '⏱️ 체류 시간', value: durationText, inline: true },
                { name: '남은 인원', value: `${oldChannel.members.filter(m => !m.user.bot).size}명`, inline: true },
            )
            .setFooter({ text: `유저 ID: ${userId}` })
            .setTimestamp();
        await sendLog(guild, 'voice', embed);
        return;
    }

    // ── 3) 음성방 이동 ──
    if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
        const session = voiceSessions.get(userId);
        let stayText = '';
        if (session) {
            const stayed = Math.floor((Date.now() - session.joinedAt) / 1000);
            stayText = ` (이전 방 체류: ${formatDuration(stayed)})`;

            // 이전 방 체류 시간도 누적
            if (!voiceStats[guild.id]) voiceStats[guild.id] = {};
            if (!voiceStats[guild.id][userId]) {
                voiceStats[guild.id][userId] = { totalSeconds: 0, joinCount: 0, lastSeen: null };
            }
            voiceStats[guild.id][userId].totalSeconds += stayed;
            saveStats();
        }
        // 새 방 기준으로 세션 갱신
        voiceSessions.set(userId, {
            channelId: newChannel.id,
            channelName: newChannel.name,
            joinedAt: Date.now(),
        });

        console.log(`[🎙️ 음성 이동] ${member.user.tag}: ${oldChannel.name} → ${newChannel.name}${stayText}`);

        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('🔀 음성방 이동')
            .setDescription(`${member} 님이 **${oldChannel.name}** → **${newChannel.name}** 으로 이동했습니다.${stayText}`)
            .setFooter({ text: `유저 ID: ${userId}` })
            .setTimestamp();
        await sendLog(guild, 'voice', embed);
        return;
    }

    // ── 4) 같은 방 안에서 상태 변화 (뮤트/화면공유/카메라 등) ──
    if (oldChannel && newChannel && oldChannel.id === newChannel.id) {
        const changes = [];

        if (oldState.selfMute !== newState.selfMute) {
            changes.push(newState.selfMute ? '🔇 마이크 음소거' : '🎤 마이크 켬');
        }
        if (oldState.selfDeaf !== newState.selfDeaf) {
            changes.push(newState.selfDeaf ? '🙉 헤드셋 음소거' : '👂 헤드셋 켬');
        }
        if (oldState.streaming !== newState.streaming) {
            changes.push(newState.streaming ? '📺 화면공유 시작' : '⏹️ 화면공유 종료');
        }
        if (oldState.selfVideo !== newState.selfVideo) {
            changes.push(newState.selfVideo ? '📷 카메라 켬' : '📷 카메라 끔');
        }
        if (oldState.serverMute !== newState.serverMute) {
            changes.push(newState.serverMute ? '🔒 서버 음소거 당함' : '🔓 서버 음소거 해제');
        }

        if (changes.length === 0) return;
        if (!config.logVoiceDetail) {
            // 상세 로그 끄면 콘솔만
            console.log(`[🎙️ 상태 변화] ${member.user.tag} @ ${newChannel.name}: ${changes.join(', ')}`);
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎛️ 음성 상태 변화')
            .setDescription(`${member} @ **${newChannel.name}**\n${changes.join('\n')}`)
            .setFooter({ text: `유저 ID: ${userId}` })
            .setTimestamp();
        await sendLog(guild, 'voice', embed);
    }
});

// ============================================================
// 에러 핸들링
// ============================================================
client.on('error', (e) => console.error('[클라이언트 에러]', e));
process.on('unhandledRejection', (e) => console.error('[Unhandled Rejection]', e));

// ─── 봇 시작 ───
client.login(config.token);
