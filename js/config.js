/**
 * Configuração da fonte de dados do painel.
 *
 * A fonte da verdade é a planilha Google Sheets "Controle de Migração —
 * TOTVS Protheus para Domínio Sistemas". O painel só LÊ essa planilha
 * (nunca escreve nela) — quem for mudar a fase de um cliente edita direto
 * na planilha.
 *
 * Como preencher sheetCsvUrl:
 *   1. Abra a planilha no Google Sheets.
 *   2. Arquivo → Compartilhar → Publicar na Web.
 *   3. Escolha a aba (ou "Documento inteiro", se só tiver uma aba) e
 *      formato "Valores separados por vírgula (.csv)".
 *   4. Marque para republicar automaticamente quando houver alterações.
 *   5. Clique em "Publicar", confirme, e copie o link gerado aqui embaixo.
 *
 * sheetEditUrl é opcional: o link normal de edição da planilha (o que
 * aparece na barra de endereço quando você está editando nela). Usado só
 * pelo botão "Editar na planilha" nos cards — se deixar em branco, o
 * painel usa o link do CSV mesmo (funciona, só não abre direto no modo
 * de edição).
 */
window.APP_CONFIG = {
  sheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRs3BNJKqKWJpTeRRAbBKtG7vcGmhMs5oUUencbcXXYgiqItmZh3movl7gpXnUDjvwbWQmseiYlq8Zu/pub?output=csv",
  sheetEditUrl: "https://docs.google.com/spreadsheets/d/1eeu3wNlzInr7ETVJP4NrwtzkypnhTw3Ta273d7Suhzk/edit",
};
