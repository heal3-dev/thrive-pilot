import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface GarminInviteEmailProps {
  name: string;
  link: string;
  expiresIn: string;
}

export default function GarminInviteEmail({
  name,
  link,
  expiresIn,
}: GarminInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Connect your Garmin device to Thrive Pilot</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Ready to sync your Garmin data?</Heading>
          
          <Text style={text}>Hi {name},</Text>
          
          <Text style={text}>
            Click the button below to securely connect your Garmin device to Thrive Pilot.
            This will allow us to track your wellness metrics and provide personalized insights.
          </Text>
          
          <Section style={buttonContainer}>
            <Button style={button} href={link}>
              Connect Garmin
            </Button>
          </Section>
          
          <Text style={footer}>
            This link expires in {expiresIn}. If you didn&apos;t request this, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
};

const h1 = {
  color: '#14b8a6',
  fontSize: '24px',
  fontWeight: 'bold',
  margin: '40px 0',
  padding: '0',
  textAlign: 'center' as const,
};

const text = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '26px',
  textAlign: 'left' as const,
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  backgroundColor: '#14b8a6',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 32px',
};

const footer = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '16px',
  textAlign: 'center' as const,
  marginTop: '32px',
};
