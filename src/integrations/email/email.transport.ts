export interface VerificationEmail {
  to: string;
  subject: string;
  text: string;
}
export abstract class EmailTransport {
  abstract send(message: VerificationEmail): Promise<void>;
}
export function verificationEmail(
  to: string,
  frontendUrl: string,
  token: string,
): VerificationEmail {
  // Le fragment évite de transmettre le token au serveur frontend et aux journaux d'accès.
  const url = new URL('/verify-email', frontendUrl);
  url.hash = new URLSearchParams({ token }).toString();
  return {
    to,
    subject: 'Vérifiez votre adresse email — Candidly',
    text: `Bienvenue sur Candidly.\n\nVérifiez votre adresse email : ${url.toString()}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.`,
  };
}

export function passwordResetEmail(
  to: string,
  frontendUrl: string,
  token: string,
): VerificationEmail {
  const url = new URL('/reset-password', frontendUrl);
  url.hash = new URLSearchParams({ token }).toString();
  return {
    to,
    subject: 'Réinitialisez votre mot de passe — Candidly',
    text: `Une récupération de votre compte Candidly a été demandée.\n\nChoisissez un nouveau mot de passe : ${url.toString()}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message. Votre mot de passe reste inchangé.`,
  };
}
