#ifndef __AS5600_H
#define __AS5600_H

#include "stm32f10x.h"

#define AS5600_STATUS_MH 0x08
#define AS5600_STATUS_ML 0x10
#define AS5600_STATUS_MD 0x20

void AS5600_Init(void);
uint8_t AS5600_ReadStatus(void);
uint16_t AS5600_ReadRawAngle(void);
uint16_t AS5600_ReadAngle(void);
uint16_t AS5600_ReadAngleDegree10(void);
uint16_t AS5600_ReadSpeedDisplay(uint16_t samplePeriodMs);

#endif
