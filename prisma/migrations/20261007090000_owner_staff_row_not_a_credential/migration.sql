-- B3: an owner's BusinessStaff row is never a credential. Owners sign in as
-- AppUser at /login (the password a reset changes); /staff-login now refuses
-- owner rows. This also disables the copy of the owner's password that was
-- stored on the row at signup, so an old password can't be reused anywhere.
-- Not a bcrypt hash, so bcrypt.compare() against it is always false.
UPDATE "business_staff"
SET "password_hash" = '!owner-signs-in-at-login',
    "reset_token" = NULL,
    "reset_token_expiry" = NULL
WHERE "is_owner" = true;
