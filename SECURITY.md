# Security Incident Response Policy

**Applies to:** FynkTech AI (Shopify app) and the FynkTech OMS it connects to.
**Last updated:** 2026-09-15
**Contact:** fynktech@gmail.com

## Purpose

This policy describes how we detect, contain, and respond to a security
incident affecting merchant or customer personal data processed by FynkTech
AI - including Shopify access tokens, webhook secrets, and order/customer
data (name, email, phone, address) synced into the FynkTech OMS.

## What counts as a security incident

- Unauthorized access to the production database (Supabase Postgres)
- A leaked or compromised credential (database password, API key, Shopify
  access token, service-role key)
- Unauthorized access to a merchant's Shopify Admin API access token
- Any suspected exposure of customer personal data (name, email, phone,
  address) to a party who should not have had access to it

## Response steps

**1. Contain (immediately on detection)**
- Rotate the compromised credential (database password, API key, or
  Shopify access token) across every service that uses it.
- If needed, temporarily take the affected service offline to stop ongoing
  unauthorized access.

**2. Assess (within 24 hours)**
- Determine what data was accessed or exposed, and which merchants/stores
  are affected.
- Review Supabase, Fly.io, and Vercel access logs to establish the scope.

**3. Notify (within 72 hours of confirming a breach)**
- Notify affected merchants at the email address on file.
- Notify Shopify via the Partner Dashboard if merchant or customer data was
  involved.
- Notify the relevant data protection authority if required by law.

**4. Remediate**
- Fix the root cause (patch the vulnerability, close the access path).
- Force re-authentication / reconnect for affected merchant accounts if
  their credentials were part of the incident.

**5. Post-incident review**
- Document what happened, the root cause, and what changes (code,
  process, or access control) will prevent it from happening again.

## Roles

- **fynktech@gmail.com** is the primary point of contact for reporting and
  responding to security incidents.

## Review

This policy is reviewed whenever a security incident occurs, and at least
once a year otherwise, as the system and team grow.
