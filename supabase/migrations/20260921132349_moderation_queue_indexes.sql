-- Cover foreign keys used by account deletion, business cleanup and admin audit joins.
create index content_moderation_author on private.content_moderation (author_id);
create index content_moderation_business on private.content_moderation (business_id);
create index content_moderation_resolver on private.content_moderation (resolved_by) where resolved_by is not null;
