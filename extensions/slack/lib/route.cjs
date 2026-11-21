const statuses = {
  es: {
    typing: 'Escribiendo…',
    attachmentOnly: 'Te envío estos archivos.',
    attachmentRejected: 'No pude recibir uno o más adjuntos. Podés enviar hasta 5 archivos, con 10 MB por imagen y 25 MB en total. Revisá el formato y volvé a intentar.',
    needsInput: 'El agente está esperando una respuesta en el panel.',
    timeout: 'Sigue trabajando; lo dejo corriendo.',
    failed: 'Algo falló; revisá el panel.',
  },
  en: {
    typing: 'Typing…',
    attachmentOnly: 'I am sending these files.',
    attachmentRejected: 'I could not receive one or more attachments. You can send up to 5 files, with 10 MB per image and 25 MB in total. Check the format and try again.',
    needsInput: 'The agent is waiting for an answer in the panel.',
    timeout: "Still working; I'll leave it running.",
    failed: 'Something failed; check the panel.',
  },
};

function statusText(kind, language) {
  return statuses[language][kind];
}

function outcome(result) {
  const text = result?.reply?.text;
  if (result?.exitCode === 0 && typeof text === 'string' && text.trim()) {
    return {text, kind: 'reply', state: 'idle'};
  }
  if (result?.exitCode === 3) return {text: null, kind: 'needsInput', state: 'waiting'};
  if (result?.exitCode === 4) return {text: null, kind: 'timeout', state: 'working'};
  return {text: null, kind: 'failed', state: 'idle'};
}

module.exports = {statusText, outcome};
