type PasswordRecoveryTemplateParams = {
  name?: string | null
  link: string
  expiresIn?: string
}

export function passwordRecoveryTemplate(params: PasswordRecoveryTemplateParams) {
  const name = (params.name ?? '').trim() || 'there'
  const expiresIn = params.expiresIn ?? '1 hour'
  const safeLink = params.link

  return `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #f8fafc; padding: 24px;">
    <div style="max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;">
      <h1 style="margin: 0 0 12px; font-size: 20px; color: #0f172a;">Reset your Thrive Pilot password</h1>
      <p style="margin: 0 0 16px; color: #334155; line-height: 1.5;">
        Hi ${name}, we received a request to reset your password.
      </p>
      <p style="margin: 0 0 16px; color: #334155; line-height: 1.5;">
        Click the button below to choose a new password. This link expires in ${expiresIn}.
      </p>
      <p style="margin: 0 0 18px;">
        <a href="${safeLink}" style="display: inline-block; background: #0d9488; color: white; text-decoration: none; padding: 12px 16px; border-radius: 12px; font-weight: 700;">
          Reset password
        </a>
      </p>
      <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.4;">
        If you did not request this, you can ignore this email.
      </p>
    </div>
  </div>
  `
}

