export function parseTemplate(template, variables) {
  if (!template) return '';
  return template
    .replace(/{username}/g, variables.username ?? '')
    .replace(/{server}/g, variables.server ?? '')
    .replace(/{memberCount}/g, variables.memberCount ?? '');
}
