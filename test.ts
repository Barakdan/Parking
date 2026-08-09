import { checkParkingLocation } from "./backend/app/gis.js";

async function main(): Promise<void> {
    const visitorResult = await checkParkingLocation({
        latitude: 32.0875,
        longitude: 34.7728,
        gpsAccuracyMeters: 8,
        isTelAvivResident: false,
    });

    console.log(JSON.stringify(visitorResult, null, 2));

    const residentResult = await checkParkingLocation({
        latitude: 32.0875,
        longitude: 34.7728,
        gpsAccuracyMeters: 8,
        isTelAvivResident: true,
        residentPermitZone: 9,
    });

    console.log(JSON.stringify(residentResult, null, 2));
}

main().catch(console.error);