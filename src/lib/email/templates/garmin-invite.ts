export function garminInviteTemplate(params: {
  name: string;
  link: string;
  expiresIn: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1>Connect Your Garmin</h1>
      <p>Hi ${params.name},</p>
      <p>Click the button below to securely connect your Garmin device to Thrive Pilot.</p>
      <a href="${params.link}" style="display: inline-block; padding: 14px 32px; background-color: #0d9488; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; mso-line-height-rule: exactly; line-height: 1.4;">
        <span style="color: #ffffff !important;">Connect Garmin</span>
      </a>
      <p style="color: #64748b; font-size: 14px; margin-top: 24px;">
        This link expires in ${params.expiresIn}.
      </p>
    </div>
  `;
}
