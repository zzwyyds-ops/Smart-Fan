#include "stm32f10x.h"
#include "Delay.h"
#include "OLED.h"
#include "AS5600.h"
#include "send.h"

#define FAN_SAMPLE_PERIOD_MS 10

uint8_t uu[] = {0xFF, 0x15 ,0x80 ,0x58 ,0x019,0xFE};

int main(void)
{
    uint16_t rpmDisplay;

    OLED_Init();
    AS5600_Init();
	send_init();
    OLED_Clear();
    OLED_ShowString(2, 1, "RPM:");

    while (1)
    {
        /* 采样周期和下面的 Delay_ms 必须保持一致，这样改延时后测速仍然正确 */
        rpmDisplay = AS5600_ReadSpeedDisplay(FAN_SAMPLE_PERIOD_MS);
		uu[3] = rpmDisplay;
        OLED_ShowNum(2, 5, rpmDisplay, 3);

		SendShuzhu(uu,6);
        Delay_ms(FAN_SAMPLE_PERIOD_MS);
    }
}
