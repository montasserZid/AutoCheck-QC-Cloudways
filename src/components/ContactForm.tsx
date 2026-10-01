"use client";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import {
  submitContactMessage,
  type ContactSubmission,
} from "@/lib/contactSubmission";
import { removeLocal } from "@/lib/localStorage";
import { contactTopics } from "@/content/contact";

const emptyForm: ContactSubmission = {
  topic: contactTopics[0],
  name: "",
  email: "",
  message: "",
};

export function ContactForm() {
  const [form, setForm] = useState<ContactSubmission>(emptyForm);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Remove contact PII saved by the previous local-only implementation.
    removeLocal("contact");
  }, []);

  function update<K extends keyof ContactSubmission>(
    key: K,
    value: ContactSubmission[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSaved(false);
    setError("");
    try {
      await submitContactMessage(form);
      setForm(emptyForm);
      setSaved(true);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We couldn't send your message right now. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form className="contact-form" onSubmit={submit}>
      <h2>How can we help?</h2>
      <p>Choose a topic so your message has the right context.</p>
      {saved && (
        <p className="notice" role="status">
          <Check size={20} />
          Your message was received. Our team can now review it.
        </p>
      )}
      {error && (
        <p className="form-errors" role="alert">
          {error}
        </p>
      )}
      <label>
        Topic
        <select
          name="topic"
          value={form.topic}
          onChange={(event) => update("topic", event.target.value)}
        >
          {contactTopics.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Your name
          <input
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={200}
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </label>
      </div>
      <label>
        Message
        <textarea
          name="message"
          rows={6}
          required
          maxLength={4000}
          value={form.message}
          onChange={(event) => update("message", event.target.value)}
        />
        <small>Do not include identity documents or payment details.</small>
      </label>
      <p className="fine-print">
        Messages are sent to AutoCheck QC for support follow-up.
      </p>
      <button
        className="button button-primary"
        type="submit"
        disabled={submitting}
      >
        {submitting ? "Sending..." : "Send Message"}
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
