#ifndef __LED_H
#define __LED_H
#include <stdio.h>
extern uint8_t TxPacket[4];//4可以不要
extern uint8_t Rxpacket[4];
void SendByte(uint8_t Byte);
void send_init(void);
void SendShuzhu(uint8_t *Shuzhu,uint16_t uu);
void SendString(char String[]);
void SendNumber(uint32_t Number,uint8_t uu);
void Serial_Printf(char*format,...);
uint8_t GetRxFlag(void);
void SendPacket(void);
#endif
