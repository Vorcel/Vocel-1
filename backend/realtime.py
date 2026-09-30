"""Hub de tempo real (WebSocket) — salas isoladas por chave.

Uma sala agrupa as conexões que devem receber os mesmos eventos (ex.: todas as
abas abertas na MESMA planilha de orçamento do MESMO usuário). O hub não é fonte
de verdade: os eventos só são publicados DEPOIS que a alteração foi persistida no
MongoDB. Se uma conexão perde eventos (queda de rede), o cliente ressincroniza via
GET ao reconectar.

Implementação em memória = uma única instância do backend (cenário atual do
Render). Para escalar horizontalmente basta trocar `publish` por um broker
(Redis Pub/Sub, por exemplo): cada instância assina os canais das suas salas e
repassa às conexões locais. A interface join/leave/publish não muda."""
import asyncio
import logging
from typing import Dict, Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)

SEND_TIMEOUT = 5  # segundos; conexão lenta/morta não segura o envio para as outras


class RoomHub:
    def __init__(self) -> None:
        self._rooms: Dict[str, Set[WebSocket]] = {}

    def join(self, room: str, ws: WebSocket) -> None:
        self._rooms.setdefault(room, set()).add(ws)

    def leave(self, room: str, ws: WebSocket) -> None:
        conns = self._rooms.get(room)
        if not conns:
            return
        conns.discard(ws)
        if not conns:
            self._rooms.pop(room, None)

    async def publish(self, room: str, event: dict) -> None:
        conns = list(self._rooms.get(room, ()))
        if not conns:
            return

        async def _send(ws: WebSocket):
            try:
                await asyncio.wait_for(ws.send_json(event), SEND_TIMEOUT)
            except Exception:
                # Conexão morta: remove da sala; o cliente ressincroniza ao reconectar.
                self.leave(room, ws)

        await asyncio.gather(*(_send(ws) for ws in conns))


hub = RoomHub()
