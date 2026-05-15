/**
 * CanalClear Chatbot Knowledge Base
 * Easy to update — just edit this file.
 * All AI prompts reference this structured knowledge.
 */

window.CANALCLEAR_KNOWLEDGE = {
  company: {
    name: "CanalClear",
    tagline: "Panama Canal Customs Compliance Automation",
    description: "CanalClear is an AI-powered platform that automates customs compliance for every vessel transiting the Panama Canal. We handle VUMPA filings, PCSOPEP documentation, ACP regulations, and pre-transit validation.",
    email: "support@canalclear.org",
    website: "https://canalclear.org"
  },

  what_we_do: {
    summary: "CanalClear automates Panama Canal compliance filings, validates documents against ACP regulations, and reduces errors that cause $65,000+ daily surcharges.",
    key_products: [
      {
        name: "VUMPA Filing Automation",
        description: "Automate the Ventanilla Única de Trámites Marítimos Para Arribo (VUMPA) filing process. Our AI validates every field before submission to prevent costly errors."
      },
      {
        name: "PCSOPEP Validation",
        description: "Panama Canal Shipboard Oil Pollution Emergency Plan validation. We check compliance with ACP environmental requirements."
      },
      {
        name: "Document Upload & OCR",
        description: "Upload PDF or image documents and our AI automatically extracts vessel data, crew manifests, cargo declarations, and compliance certificates."
      },
      {
        name: "Fleet Compliance Dashboard",
        description: "Monitor compliance status across your entire fleet in real time. See which vessels are ready for transit and which need attention."
      },
      {
        name: "Compliance Score Tool",
        description: "Get an instant compliance score for any vessel. Identifies gaps before you submit to ACP."
      },
      {
        name: "Deadline & Regulatory Alerts",
        description: "Automated alerts for certificate expirations, filing deadlines, and regulatory changes from the Panama Canal Authority (ACP)."
      },
      {
        name: "Transit History & Audit Trail",
        description: "Full audit trail of all filings, validations, and submissions. Essential for regulatory inspections."
      }
    ],
    how_it_works: [
      {
        step: 1,
        title: "Enter Vessel Details",
        description: "Input IMO number and vessel specs, or upload your existing documents. Our AI pre-fills fields automatically."
      },
      {
        step: 2,
        title: "AI Validates",
        description: "Our 23-point validation engine checks against current ACP requirements, flags issues before submission."
      },
      {
        step: 3,
        title: "Export & Submit",
        description: "Download compliant documents or submit directly to ACP. Zero manual errors."
      }
    ],
    who_its_for: [
      "Fleet operators transiting the Panama Canal",
      "Ship agents handling compliance on behalf of vessel owners",
      "Charterers managing transit logistics",
      "Port agents and maritime lawyers",
      "Vessel operators with Neo-Panamax and Panamax vessels"
    ]
  },

  pricing: {
    intro: "CanalClear costs a fraction of traditional ship agent fees ($2,000–$5,000+ per transit). Our software handles compliance automatically.",
    tiers: [
      {
        name: "Free",
        price: "$0 / month",
        description: "Compliance Score tool + 1 free VUMPA validation per month. No account, no credit card required.",
        best_for: "Checking your compliance score before committing",
        cta: { label: "Try Demo", href: "/compliance-score" }
      },
      {
        name: "Agent Pro — Panama Canal",
        price: "$599 / month",
        description: "Unlimited VUMPA filings, crew manifest automation, ACP validation + PDF export, 96h deadline alerts. For ship agents.",
        best_for: "Ship agents handling Panama Canal transits"
      },
      {
        name: "Ops Manager — Panama Canal",
        price: "$399 / vessel / month",
        description: "Continuous PCSOPEP tracking, expiry alerts 30 days out, pre-transit validation, multi-vessel fleet dashboard. For fleet operators.",
        best_for: "Fleet operators with Panama Canal vessels"
      },
      {
        name: "Agent Pro — Suez Canal",
        price: "$899 / month",
        description: "Unlimited SCA transit permits, SCNT tonnage automation, ISPS scheduling (72h/48h/24h), fee calculator + rebate optimizer.",
        best_for: "Ship agents handling Suez Canal transits"
      },
      {
        name: "Ops Manager — Suez Canal",
        price: "$599 / vessel / month",
        description: "Convoy scheduling compliance, pilotage documentation, ISPS security monitoring, SCA expiry alerts + validation.",
        best_for: "Fleet operators with Suez Canal vessels"
      },
      {
        name: "Both Canals Bundle — Agent Pro",
        price: "$1,500 / month",
        description: "Everything in Panama + Suez Agent Pro. Unlimited VUMPA + SCA filings, both validation engines, all deadline alerts.",
        best_for: "Ship agents transiting both canals"
      },
      {
        name: "Both Canals Bundle — Ops Manager",
        price: "$900 / vessel / month (save $98/vessel/mo)",
        description: "PCSOPEP + SCA compliance tracking, both canal expiry alerts, multi-vessel fleet dashboard, pre-transit validation for both routes.",
        best_for: "Fleet operators transiting both canals"
      }
    ],
    roi: {
      line1: "One prevented fine pays for 10 months of service.",
      line2: "A single PCSOPEP documentation error costs $15,000 in fines. CanalClear Agent Pro costs $599/month for Panama or $899/month for Suez.",
      line3: "Traditional ship agents charge $2,000–$5,000+ per transit — CanalClear replaces that at flat monthly rates. Both canals bundled for $1,500/mo."
    },
    comparison: "Traditional ship agents charge $2,000–$5,000+ per transit for the same compliance work. CanalClear automates 90% of that work — AI document extraction, PCSOPEP filing, validation, PDF export — starting at $599/month for Panama Agent Pro.",
    links: {
      view_pricing: "/pricing",
      compliance_score: "/compliance-score",
      free_assessment: null  // triggers email capture modal
    }
  },

  faq: [
    {
      q: "What is VUMPA?",
      a: "VUMPA stands for Ventanilla Única de Trámites Marítimos Para Arribo — the Panama Canal Authority's unified pre-arrival filing system. All vessels transiting the Canal must submit VUMPA documentation at least 96 hours before arrival."
    },
    {
      q: "What is PCSOPEP?",
      a: "PCSOPEP is the Panama Canal Shipboard Oil Pollution Emergency Plan. ACP requires vessels to have an ACP-approved PCSOPEP before transit. CanalClear validates your PCSOPEP document against current ACP requirements."
    },
    {
      q: "How far in advance must I file?",
      a: "VUMPA requires submission at least 96 hours (4 days) before your vessel's arrival at the Canal. Missing this deadline can result in transit delays, priority slot loss, and $65,000+ daily surcharges."
    },
    {
      q: "Can CanalClear handle multiple vessels?",
      a: "Yes. Our Fleet Dashboard shows compliance status for all your vessels in one view. You can manage filings, alerts, and compliance scores across your entire fleet."
    },
    {
      q: "What documents does CanalClear handle?",
      a: "CanalClear handles VUMPA pre-arrival filings, PCSOPEP compliance documentation, crew manifests, cargo declarations (including dangerous goods), General Arrangement plans, ISPS security forms, and certificate management."
    },
    {
      q: "What languages are supported?",
      a: "CanalClear supports English, Spanish (Español), Chinese (中文), Greek (Ελληνικά), and Japanese (日本語). Our support team can assist in any of these languages."
    },
    {
      q: "Do you offer founding member pricing?",
      a: "Yes. The first 25 clients lock in lifetime rates — the price you sign up at is the price you pay forever, even as rates increase for new clients. We're currently at 7 of 25 spots. Use our lead magnets (calculator, SP-1 primer, VUMPA checklist) to validate your ROI before subscribing."
    },
    {
      q: "Can I integrate CanalClear with my existing systems?",
      a: "Yes, our Pro and Fleet Enterprise plans include API access for integration with fleet management systems, ERP software, and port agent platforms."
    },
    {
      q: "Is CanalClear worth it compared to a ship agent?",
      a: "Ship agents charge $2,000–$5,000+ per transit for the same compliance work. A single PCSOPEP documentation error can cost $15,000 in fines — CanalClear Agent Pro costs $599/month for Panama or $899/month for Suez. One prevented fine pays for years of service. Our software automates 90% of what an agent does manually."
    },
    {
      q: "Is there a free trial?",
      a: "We don't offer a free trial, but you can try our live demos at no cost — no login required. We also offer free compliance assessments so you can see exactly how CanalClear fits your workflow before committing. All plans are month-to-month with no contracts."
    }
  ],

  translations: {
    en: {
      welcome_title: "Hi! I'm Clara 👋",
      welcome_msg: "I'm CanalClear's AI assistant. Ask me anything about Panama Canal compliance, pricing, or schedule a meeting with our team.",
      placeholder: "Ask about compliance, pricing, or transit...",
      quick_actions: {
        what_is: "What is CanalClear?",
        pricing: "Pricing",
        schedule: "Schedule a Meeting",
        compliance: "Check Compliance Score",
        contact: "Contact Us"
      },
      schedule_title: "Schedule a Meeting",
      name_label: "Full Name",
      email_label: "Email Address",
      company_label: "Company Name (optional)",
      fleet_label: "Fleet Size (optional)",
      date_label: "Preferred Date",
      time_label: "Preferred Time",
      timezone_label: "Timezone",
      message_label: "Brief message or topic (optional)",
      submit_btn: "Request Meeting",
      submitting: "Sending...",
      success_msg: "Meeting request received! We'll confirm within 24 hours. 🚢",
      error_msg: "Something went wrong. Please try again or email us at support@canalclear.org",
      powered_by: "Powered by CanalClear",
      fleet_options: ["1–5 vessels", "6–20 vessels", "21–50 vessels", "50+ vessels"],
      time_options: ["Morning (8am–12pm)", "Afternoon (12pm–5pm)", "Evening (5pm–8pm)"],
      typing: "Clara is thinking...",
      fallback: "I don't have a specific answer for that, but our team would love to help! You can email us at support@canalclear.org or schedule a meeting using the button below.",
      contact_team: "Contact Our Team"
    },
    es: {
      welcome_title: "¡Hola! Soy Clara 👋",
      welcome_msg: "Soy el asistente de IA de CanalClear. Pregúntame sobre cumplimiento del Canal de Panamá, precios o programa una reunión con nuestro equipo.",
      placeholder: "Pregunta sobre cumplimiento, precios o tránsito...",
      quick_actions: {
        what_is: "¿Qué es CanalClear?",
        pricing: "Precios",
        schedule: "Programar Reunión",
        compliance: "Verificar Puntuación",
        contact: "Contáctanos"
      },
      schedule_title: "Programar una Reunión",
      name_label: "Nombre completo",
      email_label: "Correo electrónico",
      company_label: "Nombre de empresa (opcional)",
      fleet_label: "Tamaño de flota (opcional)",
      date_label: "Fecha preferida",
      time_label: "Hora preferida",
      timezone_label: "Zona horaria",
      message_label: "Mensaje breve (opcional)",
      submit_btn: "Solicitar Reunión",
      submitting: "Enviando...",
      success_msg: "¡Solicitud de reunión recibida! Confirmaremos en 24 horas. 🚢",
      error_msg: "Algo salió mal. Por favor intenta de nuevo o escríbenos a support@canalclear.org",
      powered_by: "Desarrollado por CanalClear",
      fleet_options: ["1–5 barcos", "6–20 barcos", "21–50 barcos", "50+ barcos"],
      time_options: ["Mañana (8am–12pm)", "Tarde (12pm–5pm)", "Noche (5pm–8pm)"],
      typing: "Clara está pensando...",
      fallback: "No tengo una respuesta específica para eso, ¡pero nuestro equipo puede ayudarte! Escríbenos a support@canalclear.org o programa una reunión.",
      contact_team: "Contactar al Equipo"
    },
    zh: {
      welcome_title: "你好！我是 Clara 👋",
      welcome_msg: "我是 CanalClear 的 AI 助手。请问我关于巴拿马运河合规、定价或预约与我们团队会面的任何问题。",
      placeholder: "询问合规、定价或过境事宜...",
      quick_actions: {
        what_is: "什么是 CanalClear？",
        pricing: "定价",
        schedule: "预约会议",
        compliance: "检查合规评分",
        contact: "联系我们"
      },
      schedule_title: "预约会议",
      name_label: "全名",
      email_label: "电子邮件",
      company_label: "公司名称（可选）",
      fleet_label: "船队规模（可选）",
      date_label: "首选日期",
      time_label: "首选时间",
      timezone_label: "时区",
      message_label: "简短留言（可选）",
      submit_btn: "申请会议",
      submitting: "发送中...",
      success_msg: "会议申请已收到！我们将在 24 小时内确认。🚢",
      error_msg: "出现错误。请重试或发送邮件至 support@canalclear.org",
      powered_by: "由 CanalClear 提供支持",
      fleet_options: ["1–5 艘", "6–20 艘", "21–50 艘", "50+ 艘"],
      time_options: ["上午 (8am–12pm)", "下午 (12pm–5pm)", "晚上 (5pm–8pm)"],
      typing: "Clara 正在思考...",
      fallback: "我没有具体答案，但我们的团队很乐意帮助您！请发送邮件至 support@canalclear.org 或预约会议。",
      contact_team: "联系我们的团队"
    },
    el: {
      welcome_title: "Γεια! Είμαι η Clara 👋",
      welcome_msg: "Είμαι ο AI βοηθός του CanalClear. Ρωτήστε με για συμμόρφωση στη Διώρυγα του Παναμά, τιμές ή κλείστε ραντεβού με την ομάδα μας.",
      placeholder: "Ρωτήστε για συμμόρφωση, τιμές ή διαμετακόμιση...",
      quick_actions: {
        what_is: "Τι είναι το CanalClear;",
        pricing: "Τιμές",
        schedule: "Κλείσιμο Συνάντησης",
        compliance: "Έλεγχος Συμμόρφωσης",
        contact: "Επικοινωνία"
      },
      schedule_title: "Κλείστε μια Συνάντηση",
      name_label: "Ονοματεπώνυμο",
      email_label: "Email",
      company_label: "Εταιρεία (προαιρετικό)",
      fleet_label: "Μέγεθος στόλου (προαιρετικό)",
      date_label: "Προτιμώμενη ημερομηνία",
      time_label: "Προτιμώμενη ώρα",
      timezone_label: "Ζώνη ώρας",
      message_label: "Σύντομο μήνυμα (προαιρετικό)",
      submit_btn: "Αίτηση Συνάντησης",
      submitting: "Αποστολή...",
      success_msg: "Το αίτημα συνάντησης ελήφθη! Θα επιβεβαιώσουμε εντός 24 ωρών. 🚢",
      error_msg: "Κάτι πήγε στραβά. Δοκιμάστε ξανά ή στείλτε email στο support@canalclear.org",
      powered_by: "Με την υποστήριξη του CanalClear",
      fleet_options: ["1–5 πλοία", "6–20 πλοία", "21–50 πλοία", "50+ πλοία"],
      time_options: ["Πρωί (8π.μ.–12μ.)", "Απόγευμα (12μ.–5μ.μ.)", "Βράδυ (5μ.μ.–8μ.μ.)"],
      typing: "Η Clara σκέφτεται...",
      fallback: "Δεν έχω συγκεκριμένη απάντηση, αλλά η ομάδα μας χαίρεται να βοηθήσει! Στείλτε email στο support@canalclear.org ή κλείστε συνάντηση.",
      contact_team: "Επικοινωνία με την Ομάδα"
    },
    ja: {
      welcome_title: "こんにちは！Claraです 👋",
      welcome_msg: "CanalClearのAIアシスタントです。パナマ運河のコンプライアンス、料金、またはチームとのミーティングについてご質問ください。",
      placeholder: "コンプライアンス、料金、通航について質問する...",
      quick_actions: {
        what_is: "CanalClearとは？",
        pricing: "料金",
        schedule: "ミーティングを予約",
        compliance: "コンプライアンススコア確認",
        contact: "お問い合わせ"
      },
      schedule_title: "ミーティングを予約",
      name_label: "氏名",
      email_label: "メールアドレス",
      company_label: "会社名（任意）",
      fleet_label: "船団規模（任意）",
      date_label: "希望日",
      time_label: "希望時間帯",
      timezone_label: "タイムゾーン",
      message_label: "簡単なメッセージ（任意）",
      submit_btn: "ミーティングを申請",
      submitting: "送信中...",
      success_msg: "ミーティングリクエストを受け付けました！24時間以内に確認いたします。🚢",
      error_msg: "エラーが発生しました。再試行するか、support@canalclear.orgまでメールをお送りください。",
      powered_by: "CanalClearが提供",
      fleet_options: ["1〜5隻", "6〜20隻", "21〜50隻", "50隻以上"],
      time_options: ["午前 (8時〜12時)", "午後 (12時〜17時)", "夜 (17時〜20時)"],
      typing: "Claraが考えています...",
      fallback: "具体的な回答はありませんが、チームがお手伝いします！support@canalclear.orgまでメールするか、ミーティングをご予約ください。",
      contact_team: "チームに連絡"
    }
  }
};
