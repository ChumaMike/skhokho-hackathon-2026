/**
 * The admin sign-in page as reached on the ADMIN host: middleware maps
 * admin.<platform>/admin-login to /platform-admin/admin-login, so the same
 * `/admin-login` URL works on both hosts. Public by design (it is the login).
 */
export { default, dynamic } from "../../admin-login/page";
