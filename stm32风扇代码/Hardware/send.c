#include "stm32f10x.h"  // Device header
#include <stdio.h>
#include <stdarg.h>
uint8_t TxPacket[4];
uint8_t Rxpacket[4];
uint8_t RxFlag;
void send_init(void)
{
RCC_APB2PeriphClockCmd(RCC_APB2Periph_USART1,ENABLE);
RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA,ENABLE);	

GPIO_InitTypeDef  GPIO_InitStructure;
GPIO_InitStructure.GPIO_Mode=GPIO_Mode_AF_PP;
GPIO_InitStructure.GPIO_Pin=GPIO_Pin_9;
GPIO_InitStructure.GPIO_Speed=GPIO_Speed_50MHz;	
GPIO_Init(GPIOA,&GPIO_InitStructure);	
	
GPIO_InitStructure.GPIO_Mode=GPIO_Mode_IPU;
GPIO_InitStructure.GPIO_Pin=GPIO_Pin_10;
GPIO_InitStructure.GPIO_Speed=GPIO_Speed_50MHz;	
GPIO_Init(GPIOA,&GPIO_InitStructure);	
	
USART_InitTypeDef  USART_InitStructure;
USART_InitStructure.USART_BaudRate=38400;//波特率
//无硬件流控制
USART_InitStructure.USART_HardwareFlowControl=USART_HardwareFlowControl_None;
USART_InitStructure.USART_Mode=USART_Mode_Tx|USART_Mode_Rx;//发送和接收都需要或起来就可以了
USART_InitStructure.USART_Parity=USART_Parity_No;//无校验
USART_InitStructure.USART_StopBits=USART_StopBits_1;//停止位1位
USART_InitStructure.USART_WordLength=USART_WordLength_8b;//因为无校验则选择8位
USART_Init(USART1, &USART_InitStructure);	

USART_ITConfig(USART1,USART_IT_RXNE,ENABLE);//启动usart的中断
//配置nvic到usart的中断
NVIC_PriorityGroupConfig(NVIC_PriorityGroup_2);
NVIC_InitTypeDef NVIC_InitStructure;
NVIC_InitStructure.NVIC_IRQChannel=USART1_IRQn;
NVIC_InitStructure.NVIC_IRQChannelCmd=ENABLE;
NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority=1;
NVIC_InitStructure.NVIC_IRQChannelSubPriority=1;
NVIC_Init(&NVIC_InitStructure);

USART_Cmd(USART1,ENABLE);	
}
//发送单个字符或数字
void SendByte(uint8_t Byte)
{
USART_SendData(USART1, Byte);//发送8位数
while(USART_GetFlagStatus(USART1,USART_FLAG_TXE)==RESET);//等待标志位
}
//发送一组字符或数字
void SendShuzhu(uint8_t *Shuzhu,uint16_t uu)//数组指针（*Shuzhu）和Shuzhu【】一样
{
uint16_t i;
for(i=0;i<uu;i++)
{
SendByte(Shuzhu[i]);
}
}
//发送一串字符
void SendString(char String[])
{
uint8_t i;
for(i=0;String[i]!=0;i++)//会自动给标志位0（仅字符型）
{
SendByte(String[i]);
}
}
//x的y次方逻辑
uint32_t mv(uint32_t x,uint32_t y)
{
uint32_t ww=1;
while(y--)
{
ww*=x;	
}	
return ww;
}
//发送一串数字
void SendNumber(uint32_t Number,uint8_t uu)
{

uint8_t i;
for(i=0;i<uu;i++)
{
SendByte(Number/mv(10,uu-i-1)%10+'0');
}
}
//printf打印
int fputc(int ch,FILE*f)//固定格式,prturnf的底层
{
SendByte(ch);
return ch;
}
//
void Serial_Printf(char*format,...)
{
char String[100];
va_list arg;//定义参数列表变量	arg是变量名
va_start(arg,format);//从format开始接收参数表到arg变量
vsprintf(String,format,arg);//从vsprintf打印字符
va_end(arg);//结束变量arg
SendString(String);	//发送字符
}
//发送数据包
void SendPacket(void)
{
SendByte(0xFF);	
SendShuzhu(TxPacket,4);
SendByte(0xFE);	
}
//接收数据（113~最后）
uint8_t GetRxFlag(void)
{
if(RxFlag==1)
{
RxFlag=0;
return 1;
}
return 0;
}

void USART1_IRQHandler(void)
{
static uint8_t RxState=0;
static uint8_t	nn=0;
if(USART_GetITStatus(USART1,USART_IT_RXNE)==SET)
{
uint8_t RxData = USART_ReceiveData(USART1);
if(RxState==0)
{
if(RxData==0xFF)
{
RxState=1;	
}	
}
else if(RxState==1)
{
Rxpacket[nn]=RxData;//写入数据
nn++;
if(nn>=4)
{
RxState=2;	
}
}
else if(RxState==2)
{
if(RxData==0xFE)
{
RxState=0;
RxFlag=1;
nn=0;
}	
}

USART_ClearITPendingBit(USART1,USART_IT_RXNE);	
}
}
