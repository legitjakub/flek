# Rozhodnutí

- Availability uses STABLE, because PostgreSQL now() is transaction-stable, not immutable. One SQL predicate is shared by search, detail and atomic claims.
- A customer profile lock serializes duplicate claims and the max-three rule. Business locks coordinate claims with suspension; lock order is profile → business → offer → booking.
- All client mutations use RPCs. No client (including an admin JWT) receives direct capacity or booking write privileges.
- Approved public inventory remains publicly readable, including to other merchants. Cross-merchant read denial applies to private inventory and bookings, resolving the conflict between the policy matrix and the literal test wording.
- The code alphabet excludes 0/O/1/I/5/S; the sample alphabet included 5 and S, contradicting its own requirement. Rejection sampling avoids modulo bias.
- March's nonexistent Prague 02:30 is rejected; October's ambiguous 02:30 uses the earlier occurrence and round-trips explicitly.
- Cancellation grace follows the specified OR rule. Its displayed deadline is the later of start−60 minutes and creation+10 minutes.
- Admin user lookup is inline in administration, with no separate Users navigation page.
- The user-required stable React/Vite SPA replaces the Sites scaffold's beta Vinext runtime. Supabase owns auth and persistence; no ChatGPT sign-in is added.
- Local Supabase runs in an isolated portable Lima VM because this machine did not have Docker. No mocked persistence is used.
- Database policy and test work precedes visual concepting, as required by the brief.
- Demonstration data contains only fictional venues and local-only accounts. The demo merchant owns examples of upcoming, completed, cancelled and no-show bookings.
- Basic scalar form validation is shared with argument construction; eligibility, capacity, discounts and authorization remain database decisions.
