export const messages = [
  'Oi! Ficou alguma dúvida sobre os produtos que conversamos? A equipe da FG Auto Shop pode te ajudar na escolha.',
  'Olá! Conseguiu avaliar as opções? Se quiser, podemos ajustar a seleção ao que você precisa.',
  'Oi! Ainda está procurando os produtos? Podemos conferir as opções e condições atuais para você.',
  'Olá! Quer que a gente retome seu atendimento ou prefere combinar outra data?',
  'Oi! Vamos encerrar este acompanhamento por enquanto. Quando precisar, é só chamar a FG Auto Shop.'
];
export function phone(value) { return String(value ?? '').replace(/\D/g, ''); }
export function validPhone(value) { return /^55\d{10,11}$/.test(value); }
// A API do wascript rejeita silenciosamente (responde "sucesso" sem entregar) o celular
// no formato padrão com o 9º dígito (55+DDD+9XXXXXXXX, 13 dígitos) — confirmado testando
// direto no Swagger deles em 2026-10-15. Ela espera o formato antigo sem o 9 (12 dígitos).
// Isso é só uma particularidade do wascript: o número "canônico" (ex. o que vem nos
// eventos de webhook do WhatsApp) continua com o 9 normalmente.
export function wascriptPhone(value) { return value.length === 13 ? value.slice(0, 4) + value.slice(5) : value; }
export function getPath(object, path) {
  if (!path) return undefined;
  return path.split('.').reduce((v, k) => v && typeof v === 'object' ? v[k] : undefined, object);
}
export function inspectEvent(payload, phonePath, authorized) {
  const value = getPath(payload, phonePath);
  if (typeof value !== 'string' && typeof value !== 'number') return 'ambiguous';
  const number = phone(value);
  if (!validPhone(number)) return 'ambiguous';
  return number === authorized ? 'test-contact' : 'ignore';
}
export function businessHours(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Fortaleza',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const read = k => parts.find(p => p.type === k)?.value;
  const day = read('weekday'), minutes = Number(read('hour')) * 60 + Number(read('minute'));
  if (day === 'Sun') return false;
  if (day === 'Sat') return minutes >= 480 && minutes < 720;
  return (minutes >= 480 && minutes < 720) || (minutes >= 870 && minutes < 1080);
}
// Calendar offsets from enrollment; actual dispatch waits for business hours.
export function schedule(start) {
  return [1,3,7,14,21].map((days, i) => ({step:i+1,due:new Date(start.getTime()+days*86400000).toISOString(),message:messages[i]}));
}
