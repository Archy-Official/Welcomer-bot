export default async function handleMemberRemove(member, guildConfigCache) {
  const { guild, user } = member;
  console.log(`[Inbound Leave] Processing target: ${user.tag} from server space: ${guild.name}`);

  const payload = {
    event: 'GUILD_MEMBER_REMOVE',
    guildId: guild.id,
    guildName: guild.name,
    userId: user.id,
    username: user.username,
    avatarURL: user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 512 }),
    memberCount: guild.memberCount
  };

  try {
    const response = await fetch(`${process.env.SERVICES_URL}/events/member-remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': process.env.API_SECRET
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`[Inbound Leave Error] Hugging Face Space returned error status: ${response.status}`);
    }
  } catch (err) {
    console.error(`[Inbound Leave Connection Failed] Network error during Hugging Face handoff: ${err.message}`);
  }
}
