/* Shared, public company facts and a useful offline conversation path.
 * Sources: SAM.md, SAM_SCRIPT.md, SAM-RECEPTIONIST-SCRIPT.md.
 * Keep operational claims separate from examples of a proposed client system.
 */
(function (root) {
  "use strict";
  const GREETING = "Hello, welcome to Company AI Architect. I am Sam, nice to meet you, and who do I have the pleasure of helping today?";
  const PRICE = "Discovery is free for thirty minutes. The AI Opportunity Audit is fifteen hundred dollars. Architect plus the fourteen-day package starts at forty-five hundred dollars; you keep the audit roadmap even if you stop there.";
  const PRIVACY = "A private client installation can run on hardware you own. This website uses hosted services, and chat may be processed by an AI provider. Please keep customer records and sensitive information out of this conversation.";

  function reply(intent, text, action, extra) {
    return Object.assign({ ok: true, source: "company-knowledge", intent, reply: text, action: action || "none", extract: {} }, extra || {});
  }
  function industry(text) {
    if (/plumb|drain|pipe|water heater/i.test(text)) return "plumbing";
    if (/hvac|heating|cooling|air conditioning/i.test(text)) return "HVAC";
    if (/electric/i.test(text)) return "electrical";
    if (/salon|spa|beauty/i.test(text)) return "salon";
    if (/dental|dentist/i.test(text)) return "dental";
    if (/real estate|realtor/i.test(text)) return "real estate";
    if (/law firm|lawyer|attorney/i.test(text)) return "law firm";
    if (/dealership|car dealer/i.test(text)) return "dealership";
    if (/restaurant|dining/i.test(text)) return "restaurant";
    if (/medical|clinic|practice/i.test(text)) return "medical practice";
    return "business";
  }
  function wantsDemo(text) {
    return /\b(demo(?:nstrat(?:e|ion))?|role[- ]?play|pretend|show (?:me|us) (?:how|what)|simulate|act (?:as|like))\b/i.test(text);
  }
  function wantsBooking(text) {
    return /\b(?:i(?:'d| would)? (?:like|want|need) to (?:book|schedule)|(?:let(?:'s| us)|please) (?:book|schedule)|book (?:me|a|the|our)|schedule (?:me|a|the|our)|show (?:me )?(?:your |the )?(?:calendar|openings)|(?:your |the )?discovery (?:call|appointment)|available (?:times|slots))\b/i.test(text) && !wantsDemo(text);
  }
  function answer(text, context) {
    const ctx = context || {};
    const s = String(text || "").trim();
    const history = (ctx.history || []).map(h => h.text || "").join(" ");
    const kind = industry(s + " " + (ctx.businessContext || "") + " " + history);
    const directPrice = /\b(price|pricing|cost|how much|expensive|fees?)\b/i.test(s);
    const directPrivacy = /\b(privacy|hipaa|secure|security|confidential|data (?:go|stay|stored|leave|live)|where.{0,20}(?:data|chat)|own hardware|on[- ]prem|compliance)\b/i.test(s);
    if (/\b(reschedule|cancel|change)\b.{0,35}\b(appointment|booking|discovery|call)\b/i.test(s)) return reply("contact", "I can take an appointment-change request for the team. Your existing appointment stays in place until the change is confirmed. Would you like to leave that request?", "none", { demo: null });
    if (/just (?:looking|browsing)|not ready|no pressure/i.test(s)) return reply("product", "Of course—take your time. You can ask me anything about our services, or we can try a short example for your business whenever you like.", "none", { demo: null, leaveBooking: true });
    if (directPrice) return reply("price", PRICE, wantsBooking(s) ? "show_calendar" : "show_packages");
    if (directPrivacy) return reply("privacy", PRIVACY);
    if (/\b(stop|end|exit|finish) (?:the )?demo\b|\bback to (?:normal|business)\b/i.test(s)) {
      return reply("product", "Of course. We're back at Company AI Architect. What would you like to explore about a setup for your business?", "none", { demo: null });
    }
    if (wantsBooking(s)) return reply("book", "Choose a time from the live openings below for a free thirty-minute discovery call.", "show_calendar", { demo: null });
    // The roleplay is intentionally local and read-only; it cannot file intake.
    if (wantsDemo(s) && (!ctx.demo || /\b(?:restart|another|new|different|start over)\b/i.test(s))) {
      const opening = kind === "plumbing" ? "Thanks for calling your plumbing team, this is Sam. Is this a repair request or a new installation?"
        : kind === "HVAC" ? "Thanks for calling your heating and cooling team, this is Sam. Are you calling about heating, cooling, or routine maintenance?"
        : kind === "electrical" ? "Thanks for calling your electrical team, this is Sam. Is this a repair request or a new project?"
        : kind === "salon" ? "Welcome to your salon, this is Sam. Which service would you like to schedule?"
        : kind === "dental" ? "Thanks for calling your dental practice, this is Sam. Are you a new patient or returning for an appointment?"
        : kind === "real estate" ? "Thanks for calling your real estate team, this is Sam. Are you looking to buy, sell, or arrange a viewing?"
        : "Thanks for calling your company, this is Sam. May I help with an appointment, a service question, or a message?";
      return reply("demo", "Let's try a quick demonstration; you'll play the customer. " + opening, "none", { demo: { industry: kind, step: 1, request: "" } });
    }
    const topicSwitch = /\b(?:company ai architect|your services|your company|what do you do|how (?:do|can|would) you|can you|integration|integrate|crm|connect|actually|real (?:call|appointment|booking)|discovery|price|pricing|cost|privacy|audit|packages?)\b/i.test(s) || wantsBooking(s);
    if (ctx.demo && !topicSwitch) {
      const demo = Object.assign({}, ctx.demo);
      if (demo.step === 1) {
        demo.request = s.slice(0, 180); demo.step = 2;
        return reply("demo", "Absolutely, I can help with that. For this demonstration, what would you like the appointment or callback to cover?", "none", { demo });
      }
      if (demo.step === 2) {
        demo.detail = s.slice(0, 180); demo.step = 3;
        return reply("demo", "Thank you, that gives me the context. Using made-up details for this demo, what name and preferred callback window should I include?", "none", { demo });
      }
      const request = demo.request.replace(/[<>]/g, "").slice(0, 90);
      const detail = (demo.detail || "").replace(/[<>]/g, "").slice(0, 90);
      const callback = s.replace(/[<>]/g, "").slice(0, 70);
      return reply("demo", "Here's the sample intake: " + request + "; " + detail + "; callback: " + callback + ". A configured workflow could route those details for follow-up; no real appointment or callback was created. What would you change for your business?", "none", { demo: null });
    }
    if (/\b(phone|calls?|transfer|dispatch|24\/7|twenty.four)\b/i.test(s)) {
      return reply("product", "A configured AI receptionist could greet callers, capture what they need, and route appointment requests or messages. Here I can demonstrate that conversation; live phone answering needs a connected phone system. What kind of calls does your business handle?", "none", { demo: null });
    }
    if (/\b(integrat|connect|crm|salesforce|hubspot|google calendar|outlook|servicetitan|jobber|tools|software)\w*\b/i.test(s)) {
      return reply("product", "We start with the tools you already use and map what needs to move between them. A specific connection depends on access, permissions, and testing during scoping. Which system would you want to connect first?");
    }
    if (/\b(audit|roadmap|90.day)\b/i.test(s)) {
      return reply("product", "The AI Opportunity Audit maps how your company works and ranks practical automation opportunities. You receive a PDF, a one-page summary, and a ninety-day plan you keep whether or not you move into implementation. Which process would you most like reviewed?", "show_stages");
    }
    if (/\b(how long|timeline|14.day|fourteen|process|stages|method|work together)\b/i.test(s)) {
      return reply("product", "We map your workflow, rank the opportunities, then design and package a practical plan. The audit is about a week; the Architect package includes a scoped fourteen-day engagement. Specific integrations and delivery dates are agreed after discovery.", "show_stages");
    }
    if (/\b(guarantee|roi|return on|results|save|savings|worth|skeptic|tried ai|chatbot)\b/i.test(s)) {
      return reply("product", "The useful test is whether a system improves a real task your team does today. We rank opportunities by time, effort, and fit, then scope the work; we don't guarantee a savings figure. What repetitive task would you want to measure first?");
    }
    if (/\b(where|location|atlanta|nationwide|remote|service area)\b/i.test(s)) {
      return reply("product", "We're based around Greater Atlanta and work with businesses nationwide remotely. Discovery helps us establish what can be handled remotely and whether any local hardware is needed.");
    }
    if (/\b(who are you|your name|are you (?:real|human|ai|a bot)|avatar|receptionist)\b/i.test(s)) {
      return reply("who", "I'm Sam, Company AI Architect's AI receptionist. I can explain our services, walk you through a sample customer conversation, help you choose a discovery time, or take a message. What would be most useful for you?");
    }
    if (/\b(missed|after.hours|manual|repetitive|voicemail|overwhelmed|drowning|job notes)\b/i.test(s)) {
      return reply("shop_leak", "That sounds like a good workflow to examine: what comes in, what needs a response, and where the details get lost. We can design intake and follow-up around that process. Which part takes the most attention from your team?");
    }
    if (/\b(what.*(?:do|offer|able|can)|services?|business|companies|company|help|automation|capabilities)\b/i.test(s)) {
      return reply("product", kind === "business"
        ? "We design AI automation around your business: customer intake, useful job notes, connected workflows, and private AI where it fits. We start by identifying what would save your team effort. What kind of business do you run?"
        : "For your " + kind + " business, we could design a workflow that captures customer requests, organizes useful notes, and connects the next step to your existing tools. We scope those connections before promising an integration. Where does your team lose the most time today?");
    }
    if (/^(yes|sure|go ahead|okay|ok|please)[.!]*$/i.test(s) && /demonstration|sample customer|walk you through/i.test(history.slice(-650))) {
      return answer("Show me a demo for " + kind, ctx);
    }
    return null;
  }
  root.SamKnowledge = { GREETING, PRICE, PRIVACY, answer, wantsDemo, wantsBooking };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SamKnowledge;
})(typeof window !== "undefined" ? window : globalThis);
