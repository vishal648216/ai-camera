/**
 * PersonaPRO — cPanel / Phusion Passenger Application Entrypoint
 * This file delegates directly to index.js to support cPanel hosts
 * that default the application startup file to 'app.js'.
 */
require('./index.js');
