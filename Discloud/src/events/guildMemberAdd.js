export default async function handleMemberAdd(member, guildConfigCache) {
  const { guild, user } = member;
  console.log(`[Inbound Join] Processing target: ${user.tag} inside server space: ${guild.name}`);

  // Reference configurations safely from running cache limits
  const cachedConfig = guildConfigCache.get(guild.id) || null;

  const payload = {
    event: 'GUILD_MEMBER_ADD',
    guildId: guild.id,
    guildName: guild.name,
    userId: user.id,
    username: user.username,
    avatarURL: user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 512 }),
    memberCount: guild.memberCount,
    cachedConfig: cachedConfig
  };

  try {
    const response = await fetch(`${process.env.SERVICES_URL}/events/member-add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': process.env.API_SECRET
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`[Inbound Join Error] Hugging Face Space returned non-200 path: ${response.status}`);
    }
  } catch (err) {
    console.error(`[Inbound Join Connection Failed] Network error during Hugging Face handoff: ${err.message}`);
  }
}
