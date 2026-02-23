const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing ${key} in environment variables.`);
  }
  return value;
};

const sendTwilioOtp = async (phone, otp) => {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!fromNumber && !messagingServiceSid) {
    throw new Error(
      "Provide TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID."
    );
  }

  const message = `Your OTP is ${otp}. It is valid for 5 minutes.`;
  const payload = {
    To: phone,
    Body: message,
  };

  if (messagingServiceSid) {
    payload.MessagingServiceSid = messagingServiceSid;
  } else {
    payload.From = fromNumber;
  }

  const body = new URLSearchParams(payload);

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  if (!response.ok) {
    const raw = await response.text();
    let parsedMessage = raw;
    try {
      const parsed = JSON.parse(raw);
      parsedMessage =
        parsed?.message || parsed?.detail || parsed?.error || raw;
    } catch (_e) {}
    throw new Error(`Twilio SMS failed: ${parsedMessage}`);
  }
};

const sendTwilioVerifyOtp = async (phone) => {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");
  const verifyServiceSid = requireEnv("TWILIO_VERIFY_SERVICE_SID");

  const body = new URLSearchParams({
    To: phone,
    Channel: "sms",
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  if (!response.ok) {
    const raw = await response.text();
    let parsedMessage = raw;
    try {
      const parsed = JSON.parse(raw);
      parsedMessage =
        parsed?.message || parsed?.detail || parsed?.error || raw;
    } catch (_e) {}
    throw new Error(`Twilio Verify send failed: ${parsedMessage}`);
  }
};

export const verifyOtpCode = async (phone, otp) => {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");
  const verifyServiceSid = requireEnv("TWILIO_VERIFY_SERVICE_SID");

  const body = new URLSearchParams({
    To: phone,
    Code: String(otp),
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  if (!response.ok) {
    const raw = await response.text();
    let parsedMessage = raw;
    try {
      const parsed = JSON.parse(raw);
      parsedMessage =
        parsed?.message || parsed?.detail || parsed?.error || raw;
    } catch (_e) {}
    throw new Error(`Twilio Verify check failed: ${parsedMessage}`);
  }

  const data = await response.json();
  return data?.status === "approved";
};

export const sendOtpSms = async (phone, otp = "") => {
  const provider = (process.env.OTP_PROVIDER || "twilio").toLowerCase();

  if (provider === "twilio") {
    if (process.env.TWILIO_VERIFY_SERVICE_SID) {
      await sendTwilioVerifyOtp(phone);
      return;
    }
    await sendTwilioOtp(phone, otp);
    return;
  }

  throw new Error(`Unsupported OTP provider: ${provider}`);
};
