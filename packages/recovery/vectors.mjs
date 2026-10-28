// Archived envelope v2 / payload v3 interoperability input (recovery file v3, 2026-10-28). Expected key/ciphertext are
// fixed by the maintained Argon2id implementation and Web Crypto, never generated at test time. The answers, salt, IV and
// derived key are the earlier v1 vector's (the KDF input is unchanged); only the envelope header (fileId, version) and
// the opaque payload differ. Envelope v1 files have no reader any more.
export const RECOVERY_V2_VECTOR = Object.freeze({
  payload: { version: 3, issuer: 'https://identity.example', entity: '0f8e6a52-3c1b-4d7e-9a2f-5b6c7d8e9f01', recoveryToken: '0f8e6a52-3c1b-4d7e-9a2f-5b6c7d8e9f01.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8', fileId: 'ICEiIyQlJicoKSorLC0uLw', issuedAt: 1798416000000 },
  questions: [
    { id: 'name', type: 'text', prompt: 'A name with "quotes" and a \\?', hint: 'Public hint' },
    { id: 'birth', type: 'date', prompt: 'Your selected date', hint: '' },
    { id: 'ssn', type: 'ssn', prompt: 'Your selected SSN', hint: '' },
    { id: 'document', type: 'national-id', prompt: 'Your chosen document ID', hint: 'Document and country are user chosen' },
    { id: 'phone', type: 'phone', prompt: 'Your saved international phone', hint: '' },
    { id: 'pin', type: 'pin', prompt: 'Your private PIN', hint: '' },
    { id: 'phrase', type: 'passphrase', prompt: 'Your extra private phrase', hint: '' },
  ],
  answers: [' \t JOSÉ\\ "One"\n', '2000/2/29', '001-02-0003', 'ab-00123', '+44 (0)20 1234 5678', '0017', ' Quoted "Secret" \\ Café '],
  normalizedAnswers: ['josé\\ "one"', '2000-02-29', '001020003', 'AB00123', '+4402012345678', '0017', ' Quoted "Secret" \\ Café '],
  salt: 'AAECAwQFBgcICQoLDA0ODw',
  iv: 'EBESExQVFhcYGRob',
  keyHex: '1f916b78b1e77917d2098c972105b23b4b371e8291389d7175c9b4a64b0aed31',
  ciphertext: 'V7sb4XdT0YtkvZlA6kMzsyFdzHUTHPs2t_BMA9rW_x0tBQXjduA90yoGa-ekTDJAPr13CGYbJITmMA5LkhPtHhFNjJZ__uxQ-SEn-aZlJSqKITrvCUaOeBtlzb5Vw4VpCj6QGXZsnRWh3WHUTGyqxKP-4Vd6GAgC1GmEm6tdFtktU5LF7KM37lT4JXSttshY8W9-zdrkfFE1uYKuKQWJNv5tME5ZNCb0mIamE6aD73hw-Y5n9J4ApM1w-g5K9-ZB0JalRsnKasyBzUKOPiyYtjp8V5PbDBuLheLfkDDH7d1zlLArDw1p0GRdV0LNL3BWLy_A5gFQQQsNYaCEdFGdU2-ZCVYQfjnDSFmvxmMNnQ',
});
