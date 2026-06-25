#include "stm32f10x.h"
#include "Delay.h"
#include "AS5600.h"

#define AS5600_SCL_PORT GPIOA
#define AS5600_SCL_PIN  GPIO_Pin_2
#define AS5600_SDA_PORT GPIOA
#define AS5600_SDA_PIN  GPIO_Pin_1

#define AS5600_WRITE_SCL(x) GPIO_WriteBit(AS5600_SCL_PORT, AS5600_SCL_PIN, (BitAction)(x))
#define AS5600_WRITE_SDA(x) GPIO_WriteBit(AS5600_SDA_PORT, AS5600_SDA_PIN, (BitAction)(x))
#define AS5600_READ_SDA()   GPIO_ReadInputDataBit(AS5600_SDA_PORT, AS5600_SDA_PIN)

#define AS5600_ADDRESS       0x36
#define AS5600_REG_STATUS    0x0B
#define AS5600_REG_RAW_ANGLE 0x0C
#define AS5600_REG_ANGLE     0x0E
#define AS5600_RPM_DISPLAY_MAX  100
#define AS5600_RPM_MEASURED_MAX 2900

/* 保存测速状态，避免主函数里维护上一拍角度和滤波值 */
static uint16_t AS5600_SpeedPrevAngle;
static uint16_t AS5600_SpeedFilteredRpm;

static void AS5600_I2C_Delay(void)
{
    Delay_us(5);
}

static void AS5600_I2C_Start(void)
{
    AS5600_WRITE_SDA(1);
    AS5600_WRITE_SCL(1);
    AS5600_I2C_Delay();
    AS5600_WRITE_SDA(0);
    AS5600_I2C_Delay();
    AS5600_WRITE_SCL(0);
}

static void AS5600_I2C_Stop(void)
{
    AS5600_WRITE_SDA(0);
    AS5600_I2C_Delay();
    AS5600_WRITE_SCL(1);
    AS5600_I2C_Delay();
    AS5600_WRITE_SDA(1);
    AS5600_I2C_Delay();
}

static void AS5600_I2C_SendByte(uint8_t byte)
{
    uint8_t i;

    for (i = 0; i < 8; i++)
    {
        AS5600_WRITE_SDA((byte & 0x80) != 0);
        AS5600_I2C_Delay();
        AS5600_WRITE_SCL(1);
        AS5600_I2C_Delay();
        AS5600_WRITE_SCL(0);
        byte <<= 1;
    }
}

static uint8_t AS5600_I2C_ReceiveAck(void)
{
    uint8_t ack;

    AS5600_WRITE_SDA(1);
    AS5600_I2C_Delay();
    AS5600_WRITE_SCL(1);
    AS5600_I2C_Delay();
    ack = AS5600_READ_SDA();
    AS5600_WRITE_SCL(0);

    return ack;
}

static uint8_t AS5600_I2C_ReceiveByte(void)
{
    uint8_t i;
    uint8_t byte = 0;

    AS5600_WRITE_SDA(1);
    for (i = 0; i < 8; i++)
    {
        byte <<= 1;
        AS5600_WRITE_SCL(1);
        AS5600_I2C_Delay();
        if (AS5600_READ_SDA())
        {
            byte |= 0x01;
        }
        AS5600_WRITE_SCL(0);
        AS5600_I2C_Delay();
    }

    return byte;
}

static void AS5600_I2C_SendAck(uint8_t ack)
{
    AS5600_WRITE_SDA(ack);
    AS5600_I2C_Delay();
    AS5600_WRITE_SCL(1);
    AS5600_I2C_Delay();
    AS5600_WRITE_SCL(0);
    AS5600_WRITE_SDA(1);
}

static uint8_t AS5600_ReadRegister8(uint8_t reg)
{
    uint8_t data;

    AS5600_I2C_Start();
    AS5600_I2C_SendByte((AS5600_ADDRESS << 1) | 0x00);
    AS5600_I2C_ReceiveAck();
    AS5600_I2C_SendByte(reg);
    AS5600_I2C_ReceiveAck();

    AS5600_I2C_Start();
    AS5600_I2C_SendByte((AS5600_ADDRESS << 1) | 0x01);
    AS5600_I2C_ReceiveAck();
    data = AS5600_I2C_ReceiveByte();
    AS5600_I2C_SendAck(1);
    AS5600_I2C_Stop();

    return data;
}

static uint16_t AS5600_ReadRegister16(uint8_t reg)
{
    uint8_t high;
    uint8_t low;

    AS5600_I2C_Start();
    AS5600_I2C_SendByte((AS5600_ADDRESS << 1) | 0x00);
    AS5600_I2C_ReceiveAck();
    AS5600_I2C_SendByte(reg);
    AS5600_I2C_ReceiveAck();

    AS5600_I2C_Start();
    AS5600_I2C_SendByte((AS5600_ADDRESS << 1) | 0x01);
    AS5600_I2C_ReceiveAck();
    high = AS5600_I2C_ReceiveByte();
    AS5600_I2C_SendAck(0);
    low = AS5600_I2C_ReceiveByte();
    AS5600_I2C_SendAck(1);
    AS5600_I2C_Stop();

    return ((uint16_t)high << 8) | low;
}

/* 处理 0/4095 跨圈后的角度差，返回最短路径的绝对值 */
static uint16_t AS5600_GetAngleDelta(uint16_t currentAngle, uint16_t prevAngle)
{
    int32_t deltaAngle;

    deltaAngle = (int32_t)currentAngle - (int32_t)prevAngle;
    if (deltaAngle > 2048)
    {
        deltaAngle -= 4096;
    }
    else if (deltaAngle < -2048)
    {
        deltaAngle += 4096;
    }

    if (deltaAngle < 0)
    {
        deltaAngle = -deltaAngle;
    }

    return (uint16_t)deltaAngle;
}

void AS5600_Init(void)
{
    GPIO_InitTypeDef GPIO_InitStructure;

    RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA, ENABLE);

    GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_OD;
    GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;
    GPIO_InitStructure.GPIO_Pin = AS5600_SCL_PIN | AS5600_SDA_PIN;
    GPIO_Init(GPIOA, &GPIO_InitStructure);

    AS5600_WRITE_SCL(1);
    AS5600_WRITE_SDA(1);

    AS5600_SpeedPrevAngle = AS5600_ReadAngle();
    AS5600_SpeedFilteredRpm = 0;
}

uint8_t AS5600_ReadStatus(void)
{
    return AS5600_ReadRegister8(AS5600_REG_STATUS);
}

uint16_t AS5600_ReadRawAngle(void)
{
    return AS5600_ReadRegister16(AS5600_REG_RAW_ANGLE) & 0x0FFF;
}

uint16_t AS5600_ReadAngle(void)
{
    return AS5600_ReadRegister16(AS5600_REG_ANGLE) & 0x0FFF;
}

uint16_t AS5600_ReadAngleDegree10(void)
{
    return (uint16_t)((uint32_t)AS5600_ReadAngle() * 3600 / 4096);
}

/* 读取当前转速显示值。
   samplePeriodMs 必须和主循环里的 Delay_ms(samplePeriodMs) 保持一致。 */
uint16_t AS5600_ReadSpeedDisplay(uint16_t samplePeriodMs)
{
    uint16_t currentAngle;
    uint16_t deltaAngle;
    uint16_t rpm;
    uint16_t rpmDisplay;

    if (samplePeriodMs == 0)
    {
        return 0;
    }

    currentAngle = AS5600_ReadAngle();
    deltaAngle = AS5600_GetAngleDelta(currentAngle, AS5600_SpeedPrevAngle);

    /* 4096 个角度计数对应一整圈，60000/samplePeriodMs 用来换算成 RPM */
    rpm = (uint16_t)((uint32_t)deltaAngle * 60000 / (4096 * samplePeriodMs));
    AS5600_SpeedFilteredRpm = (uint16_t)((AS5600_SpeedFilteredRpm * 3 + rpm) / 4);
    AS5600_SpeedPrevAngle = currentAngle;

    rpmDisplay = (uint16_t)((uint32_t)AS5600_SpeedFilteredRpm * AS5600_RPM_DISPLAY_MAX / AS5600_RPM_MEASURED_MAX);
    if (rpmDisplay > AS5600_RPM_DISPLAY_MAX)
    {
        rpmDisplay = AS5600_RPM_DISPLAY_MAX;
    }

    return rpmDisplay;
}
