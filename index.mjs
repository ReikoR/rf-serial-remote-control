import {SteamController} from "./steam-controller.mjs";
import {CRC} from 'crc-full';
import SerialPort from 'serialport';

const crc = CRC.default("CRC8");

let robotConfig = {
    robotRadius: 0.1,
    wheelRadius: 0.025,
    wheelFromCenter: 0.1,
    wheel1Angle: 240,
    wheel2Angle: 120,
    wheel3Angle: 0,
    metricToRobot: 1
};

const encoderCPR = 64;
const gearboxReduction = 18.75;
const pidFrequency = 100;
const wheelCountsPerRevolution = encoderCPR * gearboxReduction;
const countsPerPidPeriod = wheelCountsPerRevolution / pidFrequency;
const wheelCircumference = robotConfig.wheelRadius * 2 * Math.PI;

robotConfig.metricToRobot = countsPerPidPeriod / wheelCircumference;

let speedSendInterval;
let speeds = [0, 0, 0];

let ySpeed = 0;
let xSpeed = 0;
let rotation = 0;

let prevButtons = {};

const defaultMaxSpeed = 0.2;
let maxSpeed = defaultMaxSpeed;
const defaultMaxRotation = 0.5;
let maxRotation = defaultMaxRotation;

const port = new SerialPort('COM11', {
    baudRate: 9600
});

const controller = new SteamController();

while (!controller.isConnected) {
    try {
        controller.connect();
    } catch (e) {
        console.log(e);
    }
}

controller.on('data', (data) => {
    //console.log(data.center);//, data.bottom);

    //console.log(data.status);

    if (data.status !== 'input') {
        return;
    }

    if (!prevButtons.A && data.button.A) {
        console.log('A');
        maxSpeed = defaultMaxSpeed;
        maxRotation = defaultMaxRotation;
        console.log(maxSpeed);
    }

    if (!prevButtons.X && data.button.X) {
        console.log('X');
        maxSpeed /= 2;
        maxRotation /= 2;
        console.log(maxSpeed);
    }

    if (!prevButtons.Y && data.button.Y) {
        console.log('Y');
        maxSpeed *= 2;
        maxRotation *= 2;
        console.log(maxSpeed);
    }

    prevButtons = clone({ ...data.button, ...data.center });

    xSpeed = data.joystick.x / 32768 * maxSpeed;
    ySpeed = data.joystick.y / 32768 * maxSpeed;

    rotation = -data.mouse.x / 32768 * maxRotation;

    //console.log(data);
});

function clone(obj) {
    let cloned = {};

    for (let key in obj) {
        cloned[key] = obj[key];
    }

    return cloned;
}

function setSpeeds(speeds, callback) {
    console.log('setSpeeds', speeds);

    if (!port.isOpen) {
        if (typeof callback === 'function') {
            callback();
        }

        return;
    }

    const commandBuffer = Buffer.alloc(4, 0);

    for (const [i, speed] of speeds.entries()) {
        commandBuffer.writeInt8(Math.round(speed), i);
    }

    const crcValue = crc.compute(commandBuffer.slice(0, -1));
    commandBuffer.writeUInt8(crcValue, 3);

    console.log(commandBuffer);

    port.write(commandBuffer, (err) => {
        if (err) {
            console.log('Error on write: ', err.message)
        }

        if (typeof callback === 'function') {
            callback();
        }
    });
}

function exitHandler(options, err) {
    console.log('exitHandler', options);

    if (err) {
        console.log(err.stack);
    }

    setSpeeds([0, 0, 0], () => {
        process.exit();
    });
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {cleanup: true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit: true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit: true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit: true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit: true}));

function calcSpeeds(xSpeed, ySpeed, rotation) {
    const rotationalSpeed = speedMetricToRobot(rotationRadiansToMetersPerSecond(rotation));
    const speed = Math.sqrt(xSpeed * xSpeed + ySpeed * ySpeed);
    const angle = Math.atan2(ySpeed, xSpeed);

    const speeds = [0, 0, 0];

    speeds[0] = speedMetricToRobot(wheelSpeed(speed, angle, robotConfig.wheel1Angle / 180 * Math.PI)) + rotationalSpeed;
    speeds[1] = speedMetricToRobot(wheelSpeed(speed, angle, robotConfig.wheel2Angle / 180 * Math.PI)) + rotationalSpeed;
    speeds[2] = speedMetricToRobot(wheelSpeed(speed, angle, robotConfig.wheel3Angle / 180 * Math.PI)) + rotationalSpeed;

    return speeds;
}

function wheelSpeed(robotSpeed, robotAngle, wheelAngle) {
    return robotSpeed * Math.cos(wheelAngle - robotAngle);
}

function speedMetricToRobot(metersPerSecond) {
    return metersPerSecond * robotConfig.metricToRobot;
}

function speedRobotToMetric(wheelSpeed) {
    if (robotConfig.metricToRobot === 0) {
        return 0;
    }

    return wheelSpeed / robotConfig.metricToRobot;
}

function rotationRadiansToMetersPerSecond(radiansPerSecond) {
    return radiansPerSecond * robotConfig.wheelFromCenter;
}

speedSendInterval = setInterval(() => {
    speeds = calcSpeeds(xSpeed, ySpeed, rotation);

    console.log(speeds);

    setSpeeds(speeds);
}, 50);