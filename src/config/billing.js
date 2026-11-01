
'use strict';

module.exports = Object.freeze({
    companyName: 'HKC',

    // Virtuelle SpedV-Speditions-IBAN, keine echte Bankverbindung.
    spedvIban: 'SP15910353380000377272',

    // Dynamischer Verwendungszweck:
    // Strafzahlung {SpedV-Fahrername}
    paymentPurposePrefix: 'Strafzahlung',

    currency: 'EUR',
    speedLimitKmh: 95,
});
